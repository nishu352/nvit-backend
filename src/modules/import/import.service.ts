import { createHash, randomUUID } from "crypto";
import { prisma } from "../../config/prisma.js";
import { parseExcelOrCsvBuffer } from "./excelParser.js";
import { analyzeFileBuffer } from "./import.analyzer.js";
import { getAiMapping } from "./import.aiMapper.js";
import { createSession, getSession, deleteSession } from "./import.session.js";
import { createAuditLog } from "../../utils/auditLogger.js";
import { normalizeCompanyName } from "../../utils/normalize.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConfirmedMapping {
  company_name: string;
  category: string;
  status: string;
  cin: string;
  remarks: string;
}

export interface ImportProgressUpdate {
  processedRecords: number;
  skippedRecords: number;
  failedRecords: number;
}

// ─── LEGACY: Single-shot upload (kept for backward compatibility) ─────────────

export async function processBankExcelImport(
  bankId: string,
  fileBuffer: Buffer,
  fileName: string,
  importType: "REPLACE" | "MERGE",
  userId: string
) {
  const bank = await prisma.bank.findUnique({ where: { id: bankId } });
  if (!bank) throw new Error("Bank not found");

  const rows = parseExcelOrCsvBuffer(fileBuffer);
  const totalRecords = rows.length;

  const history = await prisma.importHistory.create({
    data: {
      bankId,
      fileName,
      importType,
      totalRecords,
      processedRecords: 0,
      skippedRecords: 0,
      failedRecords: 0,
      status: "PROCESSING",
      createdById: userId,
    },
  });

  try {
    if (importType === "REPLACE") {
      await prisma.companyBankCategory.deleteMany({ where: { bankId } });
    }

    const now = new Date().toISOString();
    const seen = new Set<string>();
    const validRows: {
      id: string;
      name: string;
      normalizedName: string;
      cin: string | null;
      category: string;
      status: string;
      remarks: string | null;
    }[] = [];

    for (const r of rows) {
      if (!r.companyName || r.companyName.length < 2) continue;
      const norm = normalizeCompanyName(r.companyName);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      validRows.push({
        id: randomUUID(),
        name: r.companyName,
        normalizedName: norm,
        cin: r.cin || null,
        category: r.category || "UNLISTED",
        status: r.status || "APPROVED",
        remarks: r.remarks || null,
      });
    }

    const CHUNK = 500;
    let processedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < validRows.length; i += CHUNK) {
      const chunk = validRows.slice(i, i + CHUNK);
      try {
        const placeholders = chunk
          .map(
            (r, idx) =>
              `($${idx * 6 + 1},$${idx * 6 + 2},$${idx * 6 + 3},$${idx * 6 + 4},$${idx * 6 + 5},$${idx * 6 + 6})`
          )
          .join(",");
        const values = chunk.flatMap((r) => [
          r.id, r.name, r.normalizedName, r.cin ?? null, now, now,
        ]);
        await prisma.$executeRawUnsafe(
          `INSERT INTO companies (id, name, "normalizedName", cin, "createdAt", "updatedAt") VALUES ${placeholders} ON CONFLICT ("normalizedName") DO NOTHING`,
          ...values
        );
      } catch (err) {
        console.error(`Company insert chunk ${i / CHUNK + 1} failed:`, err);
        failedCount += chunk.length;
      }
    }

    const allNormNames = validRows.map((r) => r.normalizedName);
    const companyMap = new Map<string, string>();
    for (let i = 0; i < allNormNames.length; i += 900) {
      const nameChunk = allNormNames.slice(i, i + 900);
      const companies = await prisma.company.findMany({
        where: { normalizedName: { in: nameChunk } },
        select: { id: true, normalizedName: true },
      });
      for (const c of companies) companyMap.set(c.normalizedName, c.id);
    }

    const categoryRows: {
      id: string;
      companyId: string;
      bankId: string;
      category: string;
      status: string;
      remarks: string | null;
    }[] = [];

    for (const r of validRows) {
      const companyId = companyMap.get(r.normalizedName);
      if (!companyId) continue;
      categoryRows.push({ id: randomUUID(), companyId, bankId, category: r.category, status: r.status, remarks: r.remarks });
    }

    for (let i = 0; i < categoryRows.length; i += CHUNK) {
      const chunk = categoryRows.slice(i, i + CHUNK);
      try {
        const placeholders = chunk
          .map(
            (r, idx) =>
              `($${idx * 7 + 1},$${idx * 7 + 2},$${idx * 7 + 3},$${idx * 7 + 4},$${idx * 7 + 5},$${idx * 7 + 6},$${idx * 7 + 7})`
          )
          .join(",");
        const values = chunk.flatMap((r) => [
          r.id, r.companyId, r.bankId, r.category, r.status, r.remarks ?? null, now,
        ]);
        await prisma.$executeRawUnsafe(
          `INSERT INTO company_bank_categories (id, "companyId", "bankId", category, status, remarks, "updatedAt") VALUES ${placeholders}
           ON CONFLICT ("companyId", "bankId") DO UPDATE SET
             category = EXCLUDED.category,
             status   = EXCLUDED.status,
             remarks  = EXCLUDED.remarks,
             "updatedAt" = EXCLUDED."updatedAt"`,
          ...values
        );
        processedCount += chunk.length;
      } catch (err) {
        console.error(`Category insert chunk ${i / CHUNK + 1} failed:`, err);
        failedCount += chunk.length;
      }

      if (i % (CHUNK * 10) === 0) {
        await prisma.importHistory.update({
          where: { id: history.id },
          data: { processedRecords: processedCount, failedRecords: failedCount },
        });
      }
    }

    const finalHistory = await prisma.importHistory.update({
      where: { id: history.id },
      data: { status: "COMPLETED", processedRecords: processedCount, failedRecords: failedCount },
    });

    await createAuditLog({
      userId,
      action: "EXCEL_IMPORTED",
      entity: "Bank",
      entityId: bankId,
      details: { fileName, importType, totalRecords, processedCount, failedCount, bankName: bank.name },
    });

    return finalHistory;
  } catch (err: any) {
    await prisma.importHistory.update({
      where: { id: history.id },
      data: { status: "FAILED", errorMessage: err.message || "Import failed" },
    });
    throw err;
  }
}

// ─── NEW Phase 1: Analyze File ────────────────────────────────────────────────

export async function analyzeUploadedFile(
  fileBuffer: Buffer,
  fileName: string,
  fileSize: number
) {
  // Analyze file structure and get schema + raw rows
  const { schema, rawRows, inFileDuplicates } = analyzeFileBuffer(fileBuffer, fileName);

  // Get AI mapping (with automatic fallback)
  const aiMapping = await getAiMapping(schema);

  // Create session — stores raw rows server-side
  const sessionId = createSession({
    fileName,
    fileSize,
    schema,
    aiMapping,
    rawRows,
    inFileDuplicates,
  });

  // Compute validation preview stats
  const companyNameCol = aiMapping.mapping.company_name;
  let validRows = 0;
  let invalidRows = 0;
  const seenNorm = new Set<string>();
  let fileDuplicates = 0;

  for (const row of rawRows) {
    const name = companyNameCol ? (row[companyNameCol] || "").trim() : "";
    if (!name || name.length < 2) {
      invalidRows++;
      continue;
    }
    const norm = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!norm) { invalidRows++; continue; }
    if (seenNorm.has(norm)) { fileDuplicates++; }
    else { seenNorm.add(norm); }
    validRows++;
  }

  return {
    sessionId,
    schema,          // Sent to client (column metadata + 10 sample rows)
    aiMapping,       // Sent to client (mapping suggestions)
    rowCount: rawRows.length,
    validRows,
    invalidRows,
    fileDuplicates,
    inFileDuplicates,
  };
}

// ─── NEW Phase 2: Confirm Import ──────────────────────────────────────────────

export async function startConfirmedImport(
  sessionId: string,
  bankId: string,
  importType: "REPLACE" | "MERGE",
  confirmedMapping: ConfirmedMapping,
  userId: string
): Promise<{ historyId: string; totalRecords: number }> {
  const session = getSession(sessionId);
  const bank = await prisma.bank.findUnique({ where: { id: bankId } });
  if (!bank) throw new Error("Bank not found");

  // Compute file hash for audit
  const dummyHash = "session-" + sessionId.substring(0, 8);

  // Pre-count valid rows using confirmed mapping
  const { validRowCount } = countValidRows(session.rawRows, confirmedMapping);

  // Create ImportHistory record immediately (PROCESSING state)
  const history = await prisma.importHistory.create({
    data: {
      bankId,
      fileName: session.fileName,
      fileHash: dummyHash,
      importType,
      totalRecords: session.rawRows.length,
      processedRecords: 0,
      skippedRecords: 0,
      failedRecords: 0,
      status: "PROCESSING",
      mappingJson: JSON.stringify(confirmedMapping),
      createdById: userId,
    },
  });

  // ── Fire-and-forget background processing ──────────────────────────────────
  processConfirmedImportBackground(
    sessionId,
    session.rawRows,
    bankId,
    bank.name,
    importType,
    confirmedMapping,
    userId,
    history.id,
    session.fileName
  ).catch(async (err: any) => {
    console.error(`[Import ${history.id}] Background processing failed:`, err.message);
    await prisma.importHistory.update({
      where: { id: history.id },
      data: {
        status: "FAILED",
        errorMessage: err.message || "Unexpected import error",
      },
    });
    deleteSession(sessionId);
  });

  return { historyId: history.id, totalRecords: session.rawRows.length };
}

// ─── Background Import Processing ────────────────────────────────────────────

async function processConfirmedImportBackground(
  sessionId: string,
  rawRows: Record<string, string>[],
  bankId: string,
  bankName: string,
  importType: "REPLACE" | "MERGE",
  mapping: ConfirmedMapping,
  userId: string,
  historyId: string,
  fileName: string
) {
  // ── Row-level error buffer ───────────────────────────────────────────────
  const errorBuffer: {
    importJobId: string;
    rowNumber: number;
    columnName?: string;
    errorCode: string;
    errorMessage: string;
    rawData?: string;
  }[] = [];

  function captureError(
    rowNum: number,
    errorCode: string,
    errorMessage: string,
    rawData?: string,
    columnName?: string
  ) {
    if (errorBuffer.length >= 1000) return; // Cap at 1,000 errors max to prevent DB overload
    errorBuffer.push({
      importJobId: historyId,
      rowNumber: rowNum,
      columnName: columnName ?? undefined,
      errorCode,
      errorMessage,
      rawData: rawData ? rawData.substring(0, 500) : undefined,
    });
  }

  async function flushErrors() {
    if (errorBuffer.length === 0) return;
    const EBATCH = 500;
    for (let i = 0; i < errorBuffer.length; i += EBATCH) {
      try {
        await prisma.importError.createMany({
          data: errorBuffer.slice(i, i + EBATCH) as any,
          skipDuplicates: true,
        });
      } catch (e: any) {
        console.error(`[Import ${historyId}] Error flush failed:`, e.message);
      }
    }
  }

  try {
    const now = new Date().toISOString();
    const CHUNK = 500;

    // ── Step 0: REPLACE mode — wipe existing mappings ──────────────────────
    if (importType === "REPLACE") {
      await prisma.companyBankCategory.deleteMany({ where: { bankId } });
    }

    // ── Step 1: Apply mapping + validate + deduplicate ─────────────────────
    const seen = new Set<string>();
    const validRows: {
      id: string;
      name: string;
      normalizedName: string;
      cin: string | null;
      category: string;
      status: string;
      remarks: string | null;
    }[] = [];

    let invalidCount = 0;
    let skippedCount = 0;

    for (let rowIdx = 0; rowIdx < rawRows.length; rowIdx++) {
      const row = rawRows[rowIdx];
      const rowNum = rowIdx + 2; // 1-indexed, +1 for header row

      // Apply confirmed mapping
      const rawName = mapping.company_name ? (row[mapping.company_name] || "").trim() : "";
      const rawCategory = mapping.category ? (row[mapping.category] || "").trim() : "";
      const rawStatus = mapping.status ? (row[mapping.status] || "").trim() : "";
      const rawCin = mapping.cin ? (row[mapping.cin] || "").trim() : "";
      const rawRemarks = mapping.remarks ? (row[mapping.remarks] || "").trim() : "";

      // Validate required: company name
      if (!rawName || rawName.length < 2) {
        invalidCount++;
        captureError(
          rowNum,
          "MISSING_NAME",
          rawName ? `Company name too short ("${rawName.substring(0, 40)}")` : "Company name column is empty",
          mapping.company_name ? `${mapping.company_name}: "${rawName.substring(0, 80)}"` : undefined,
          mapping.company_name || undefined
        );
        continue;
      }

      // Normalize company name
      const norm = normalizeCompanyName(rawName);
      if (!norm) {
        invalidCount++;
        captureError(rowNum, "INVALID_NAME", `Company name contains only special characters: "${rawName.substring(0, 80)}"`, rawName.substring(0, 200));
        continue;
      }

      // In-file duplicate detection (merge automatically, don't flag as red error)
      if (seen.has(norm)) {
        skippedCount++;
        // Update existing row in validRows with latest values if present
        const existingRow = validRows.find((r) => r.normalizedName === norm);
        if (existingRow) {
          if (rawCategory) existingRow.category = normalizeCategory(rawCategory);
          if (rawCin) existingRow.cin = rawCin.substring(0, 100);
          if (rawRemarks) existingRow.remarks = rawRemarks.substring(0, 1000);
        }
        continue;
      }
      seen.add(norm);

      // Normalize category
      const category = normalizeCategory(rawCategory);

      // Normalize status
      const statusUpper = rawStatus.toUpperCase();
      let status = "APPROVED";
      if (statusUpper.includes("REJECT") || category === "REJECT") {
        status = "REJECT";
      } else if (statusUpper.includes("BLOCK")) {
        status = "BLOCKED";
      } else if (statusUpper === "CONDITIONAL" || statusUpper.includes("COND")) {
        status = "CONDITIONAL";
      }

      validRows.push({
        id: randomUUID(),
        name: rawName.substring(0, 500), // max length
        normalizedName: norm,
        cin: rawCin ? rawCin.substring(0, 100) : null,
        category,
        status,
        remarks: rawRemarks ? rawRemarks.substring(0, 1000) : null,
      });

      // Update progress every 5,000 rows during validation
      if (rowIdx % 5000 === 0 && rowIdx > 0) {
        await prisma.importHistory.update({
          where: { id: historyId },
          data: {
            processedRecords: validRows.length,
            skippedRecords: skippedCount,
            failedRecords: invalidCount,
          },
        });
      }
    }

    // ── Step 2: Bulk INSERT companies (skip existing) ─────────────────────
    let processedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < validRows.length; i += CHUNK) {
      const chunk = validRows.slice(i, i + CHUNK);
      try {
        await prisma.company.createMany({
          data: chunk.map((r) => ({
            id: r.id,
            name: r.name,
            normalizedName: r.normalizedName,
            cin: r.cin,
          })),
          skipDuplicates: true,
        });
      } catch (err: any) {
        const errMsg = `Database error saving companies (batch ${Math.floor(i / CHUNK) + 1})`;
        console.error(`[Import ${historyId}] Company chunk ${Math.floor(i / CHUNK) + 1} failed:`, err.message);
        chunk.forEach((r, ri) =>
          captureError(i + ri + 2, "CHUNK_FAILED", errMsg, r.name.substring(0, 200))
        );
        failedCount += chunk.length;
      }
    }

    // ── Step 3: Fetch company IDs ──────────────────────────────────────────
    const allNormNames = validRows.map((r) => r.normalizedName);
    const companyMap = new Map<string, string>();

    for (let i = 0; i < allNormNames.length; i += 900) {
      const nameChunk = allNormNames.slice(i, i + 900);
      const companies = await prisma.company.findMany({
        where: { normalizedName: { in: nameChunk } },
        select: { id: true, normalizedName: true },
      });
      for (const c of companies) companyMap.set(c.normalizedName, c.id);
    }

    // ── Step 4: Bulk INSERT OR REPLACE category mappings ──────────────────
    const categoryRows: {
      id: string;
      companyId: string;
      bankId: string;
      category: string;
      status: string;
      remarks: string | null;
    }[] = [];

    for (const r of validRows) {
      const companyId = companyMap.get(r.normalizedName);
      if (!companyId) continue;
      categoryRows.push({ id: randomUUID(), companyId, bankId, category: r.category, status: r.status, remarks: r.remarks });
    }

    for (let i = 0; i < categoryRows.length; i += CHUNK) {
      const chunk = categoryRows.slice(i, i + CHUNK);
      try {
        const res = await prisma.companyBankCategory.createMany({
          data: chunk.map((r) => ({
            id: r.id,
            companyId: r.companyId,
            bankId: r.bankId,
            category: r.category,
            status: r.status,
            remarks: r.remarks,
          })),
          skipDuplicates: true,
        });
        processedCount += res.count;
      } catch (err: any) {
        const errMsg = `Database error saving category mappings (batch ${Math.floor(i / CHUNK) + 1})`;
        console.error(`[Import ${historyId}] Category chunk ${Math.floor(i / CHUNK) + 1} failed:`, err.message);
        chunk.forEach((r, ri) =>
          captureError(i + ri + 2, "CHUNK_FAILED", errMsg, `companyId: ${r.companyId}`)
        );
        failedCount += chunk.length;
      }

      // Update progress every 10 chunks (~5000 rows)
      if (i % (CHUNK * 10) === 0 && i > 0) {
        await prisma.importHistory.update({
          where: { id: historyId },
          data: {
            processedRecords: processedCount,
            skippedRecords: skippedCount,
            failedRecords: failedCount + invalidCount,
          },
        });
      }
    }

    // ── Step 5: Flush row-level errors to DB ──────────────────────────────
    await flushErrors();

    // ── Step 6: Mark COMPLETED ────────────────────────────────────────────
    const totalFailed = failedCount + invalidCount;
    await prisma.importHistory.update({
      where: { id: historyId },
      data: {
        status: "COMPLETED",
        processedRecords: processedCount,
        skippedRecords: skippedCount,
        failedRecords: totalFailed,
        completedAt: new Date(),
      },
    });

    await createAuditLog({
      userId,
      action: "AI_EXCEL_IMPORTED",
      entity: "Bank",
      entityId: bankId,
      details: {
        fileName,
        importType,
        bankName,
        totalRows: rawRows.length,
        processedCount,
        skippedCount,
        failedCount: totalFailed,
        errorCount: errorBuffer.length,
        mappingUsed: mapping,
      },
    });

    console.log(`[Import ${historyId}] Completed: ${processedCount} imported, ${skippedCount} skipped, ${totalFailed} failed, ${errorBuffer.length} errors logged`);
  } finally {
    // Always clean up session when done (success or failure handled by caller)
    deleteSession(sessionId);
  }
}

// ─── Get Row-Level Import Errors ──────────────────────────────────────────────

export async function getImportErrors(
  historyId: string,
  page: number = 1,
  limit: number = 50,
  errorCode?: string
) {
  const skip = (page - 1) * limit;
  const where = {
    importJobId: historyId,
    ...(errorCode ? { errorCode } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.importError.count({ where }),
    prisma.importError.findMany({
      where,
      select: {
        id: true,
        rowNumber: true,
        columnName: true,
        errorCode: true,
        errorMessage: true,
        rawData: true,
        createdAt: true,
      },
      orderBy: { rowNumber: "asc" },
      skip,
      take: limit,
    }),
  ]);

  // Count by error type for summary
  const breakdown = await prisma.importError.groupBy({
    by: ["errorCode"],
    where: { importJobId: historyId },
    _count: { errorCode: true },
  });

  return {
    total,
    page,
    totalPages: Math.ceil(total / limit),
    breakdown: breakdown.map((b) => ({ code: b.errorCode, count: b._count.errorCode })),
    items,
  };
}

// ─── History ──────────────────────────────────────────────────────────────────

export async function getImportHistoryList(page: number = 1, limit: number = 20) {
  const skip = (page - 1) * limit;
  const [total, items] = await Promise.all([
    prisma.importHistory.count(),
    prisma.importHistory.findMany({
      skip,
      take: limit,
      include: {
        bank: { select: { name: true, code: true, type: true } },
        createdBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    total,
    page,
    totalPages: Math.ceil(total / limit),
    items: items.map((item: any) => ({
      id: item.id,
      bankId: item.bankId,
      bankName: item.bank.name,
      bankCode: item.bank.code,
      bankType: item.bank.type,
      fileName: item.fileName,
      importType: item.importType,
      totalRecords: item.totalRecords,
      processedRecords: item.processedRecords,
      skippedRecords: item.skippedRecords ?? 0,
      failedRecords: item.failedRecords,
      status: item.status,
      errorMessage: item.errorMessage,
      mappingJson: item.mappingJson,
      createdAt: item.createdAt,
      createdByName: item.createdBy.name,
      createdByEmail: item.createdBy.email,
    })),
  };
}

export async function getImportStatus(historyId: string) {
  const item = await prisma.importHistory.findUnique({
    where: { id: historyId },
    select: {
      id: true,
      status: true,
      totalRecords: true,
      processedRecords: true,
      skippedRecords: true,
      failedRecords: true,
      errorMessage: true,
      fileName: true,
      updatedAt: true,
    },
  });

  if (!item) throw new Error("Import record not found");
  return item;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────




function countValidRows(
  rawRows: Record<string, string>[],
  mapping: ConfirmedMapping
): { validRowCount: number } {
  const seen = new Set<string>();
  let validRowCount = 0;
  for (const row of rawRows) {
    const name = mapping.company_name ? (row[mapping.company_name] || "").trim() : "";
    if (!name || name.length < 2) continue;
    const norm = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    validRowCount++;
  }
  return { validRowCount };
}

function normalizeCategory(raw: string): string {
  if (!raw) return "UNLISTED";
  const cat = raw.trim().toUpperCase();

  if (cat === "CAT A" || cat === "A") return "CAT A";
  if (cat === "CAT B" || cat === "B") return "CAT B";
  if (cat === "CAT C" || cat === "C") return "CAT C";
  if (cat === "SUPERPRIME" || cat === "SUPER PRIME" || cat === "ELITE") return "CAT A";
  if (cat === "PREFERRED" || cat === "PRIME") return "CAT B";
  if (cat === "OPEN MARKET" || cat === "OPENMARKET") return "CAT C";
  if (cat === "GOVERNMENT" || cat === "GOVT" || cat === "GOV" || cat === "PSU") return "CAT A";
  if (cat === "MNC" || cat.includes("MULTI NATIONAL") || cat.includes("MULTINATIONAL")) return "CAT A";
  if (cat.includes("REJECT") || cat === "NL" || cat === "NOT LISTED" || cat === "BLACKLIST") return "REJECT";
  if (cat === "UNLISTED" || cat === "N/A" || cat === "NA" || cat === "") return "UNLISTED";

  return cat; // Preserve custom category values
}
