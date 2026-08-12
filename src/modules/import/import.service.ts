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
  company_name?: string;
  category?: string;
  status?: string;
  cin?: string;
  remarks?: string;
  pincode?: string;
  state?: string;
  city?: string;
  area?: string;
  serviceable?: string;
  negative?: string;
  [key: string]: string | undefined;
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
      baseName: string;
      cin: string | null;
      category: string;
      status: string;
      remarks: string | null;
    }[] = [];

    for (const r of rows) {
      if (!r.companyName || r.companyName.length < 2) continue;
      const { normalizedName: norm, baseName } = normalizeCompanyName(r.companyName);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      validRows.push({
        id: randomUUID(),
        name: r.companyName,
        normalizedName: norm,
        baseName,
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
  fileSize: number,
  entityType: string = "COMPANY"
) {
  // Analyze file structure and get schema + raw rows
  const { schema, rawRows, inFileDuplicates } = analyzeFileBuffer(fileBuffer, fileName);

  // Get AI mapping (with automatic fallback)
  const aiMapping = await getAiMapping(schema, entityType);

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
  let validRows = 0;
  let invalidRows = 0;
  const seenNorm = new Set<string>();
  let fileDuplicates = 0;

  if (entityType === "PINCODE") {
    const pincodeCol = aiMapping.mapping.pincode;
    for (const row of rawRows) {
      const pin = pincodeCol ? (row[pincodeCol] || "").trim() : "";
      if (!pin || pin.length < 3) {
        invalidRows++;
        continue;
      }
      if (seenNorm.has(pin)) { fileDuplicates++; }
      else { seenNorm.add(pin); }
      validRows++;
    }
  } else {
    const companyNameCol = aiMapping.mapping.company_name;
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
  entityType: "COMPANY" | "PINCODE",
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
  if (entityType === "PINCODE") {
    processPincodeImportBackground(
      sessionId, session.rawRows, bankId, bank.name, importType, confirmedMapping, userId, history.id, session.fileName
    ).catch(async (err: any) => {
      console.error(`[Import ${history.id}] Background processing failed:`, err.message);
      await prisma.importHistory.update({ where: { id: history.id }, data: { status: "FAILED", errorMessage: err.message || "Unexpected import error" } });
      deleteSession(sessionId);
    });
  } else {
    processConfirmedImportBackground(
      sessionId, session.rawRows, bankId, bank.name, importType, confirmedMapping, userId, history.id, session.fileName
    ).catch(async (err: any) => {
      console.error(`[Import ${history.id}] Background processing failed:`, err.message);
      await prisma.importHistory.update({ where: { id: history.id }, data: { status: "FAILED", errorMessage: err.message || "Unexpected import error" } });
      deleteSession(sessionId);
    });
  }

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
    rawJson?: any;
  }[] = [];

  function captureError(
    rowNum: number,
    errorCode: string,
    errorMessage: string,
    rawData?: string,
    columnName?: string,
    rawJson?: any
  ) {
    if (errorBuffer.length >= 1000) return; // Cap at 1,000 errors max to prevent DB overload
    errorBuffer.push({
      importJobId: historyId,
      rowNumber: rowNum,
      columnName: columnName ?? undefined,
      errorCode,
      errorMessage,
      rawData: rawData ? rawData.substring(0, 500) : undefined,
      rawJson,
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
      baseName: string;
      cin: string | null;
      category: string;
      status: string;
      remarks: string | null;
      raw: Record<string, string>;
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
          mapping.company_name || undefined,
          row
        );
        continue;
      }

      // Normalize company name
      const { normalizedName: norm, baseName } = normalizeCompanyName(rawName);
      if (!norm) {
        invalidCount++;
        captureError(rowNum, "INVALID_NAME", `Company name contains only special characters: "${rawName.substring(0, 80)}"`, rawName.substring(0, 200), undefined, row);
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
        captureError(rowNum, "DUPLICATE_IN_FILE", `Duplicate company in file, merged automatically.`, norm, undefined, row);
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
        baseName: baseName,
        cin: rawCin ? rawCin.substring(0, 100) : null,
        category,
        status,
        remarks: rawRemarks ? rawRemarks.substring(0, 1000) : null,
        raw: row
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

    // ── Step 2: Resolve Company IDs via Matching Hierarchy ────────────────
    const allNormNames = validRows.map((r) => r.normalizedName);
    const allBaseNames = Array.from(new Set(validRows.map((r) => r.baseName)));

    const existingCompanies = [];
    for (let i = 0; i < allBaseNames.length; i += 500) {
      const baseChunk = allBaseNames.slice(i, i + 500);
      const comps = await prisma.company.findMany({
        where: { baseName: { in: baseChunk } },
        select: { id: true, normalizedName: true, baseName: true },
      });
      existingCompanies.push(...comps);
    }
    
    const existingAliases = [];
    for (let i = 0; i < allNormNames.length; i += 500) {
      const normChunk = allNormNames.slice(i, i + 500);
      const aliases = await prisma.companyAlias.findMany({
        where: { alias: { in: normChunk } },
        select: { companyId: true, alias: true }
      });
      existingAliases.push(...aliases);
    }

    const companyMap = new Map<string, string>(); // validRow.id -> companyId
    const newCompaniesToCreate = [];

    const baseNameMap = new Map<string, { id: string, normalizedName: string, baseName: string | null }[]>();
    for (const c of existingCompanies) {
      if (!c.baseName) continue;
      const arr = baseNameMap.get(c.baseName) || [];
      arr.push(c);
      baseNameMap.set(c.baseName, arr);
    }

    for (const r of validRows) {
      let resolvedCompanyId: string | null = null;
      const candidates = baseNameMap.get(r.baseName) || [];

      // Level 1: Exact Match (normalizedName or Alias)
      const exactMatch = candidates.find(c => c.normalizedName === r.normalizedName);
      if (exactMatch) {
        resolvedCompanyId = exactMatch.id;
      } else {
        const aliasMatch = existingAliases.find(a => a.alias === r.normalizedName);
        if (aliasMatch) {
          resolvedCompanyId = aliasMatch.companyId;
        }
      }

      // Level 2: Missing Suffix Match (baseName)
      if (!resolvedCompanyId && candidates.length > 0) {
        const noSuffixCandidates = candidates.filter(c => c.normalizedName === c.baseName);
        const hasSuffixCandidates = candidates.filter(c => c.normalizedName !== c.baseName);

        const incomingHasNoSuffix = r.normalizedName === r.baseName;
        
        if (incomingHasNoSuffix && hasSuffixCandidates.length === 1) {
          // Incoming: "WIPRO", DB: ["WIPROLTD"] -> Safe merge
          resolvedCompanyId = hasSuffixCandidates[0].id;
        } else if (!incomingHasNoSuffix && noSuffixCandidates.length === 1) {
          // Incoming: "WIPRO LIMITED", DB: ["WIPRO"] -> Safe merge
          resolvedCompanyId = noSuffixCandidates[0].id;
        }
      }

      if (resolvedCompanyId) {
        companyMap.set(r.id, resolvedCompanyId);
      } else {
        const newId = r.id; // use the row's UUID as the new company ID
        companyMap.set(r.id, newId);
        newCompaniesToCreate.push({
          id: newId,
          name: r.name,
          normalizedName: r.normalizedName,
          baseName: r.baseName,
          cin: r.cin,
        });
        candidates.push({ id: newId, normalizedName: r.normalizedName, baseName: r.baseName });
        baseNameMap.set(r.baseName, candidates);
      }
    }

    // ── Step 3: Bulk INSERT new companies ─────────────────────────────────
    let processedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < newCompaniesToCreate.length; i += CHUNK) {
      const chunk = newCompaniesToCreate.slice(i, i + CHUNK);
      try {
        await prisma.company.createMany({
          data: chunk,
          skipDuplicates: true,
        });
      } catch (err: any) {
        const errMsg = `Database error saving companies (batch ${Math.floor(i / CHUNK) + 1})`;
        console.error(`[Import ${historyId}] Company chunk ${Math.floor(i / CHUNK) + 1} failed:`, err.message);
        failedCount += chunk.length;
      }
    }

    // ── Step 4: Bulk INSERT OR REPLACE category mappings ──────────────────
    const categoryRows: {
      id: string;
      companyId: string;
      bankId: string;
      rawCompanyName: string;
      category: string;
      status: string;
      remarks: string | null;
      raw: Record<string, string>;
    }[] = [];

    for (const r of validRows) {
      const companyId = companyMap.get(r.id);
      if (!companyId) continue;
      categoryRows.push({ 
        id: randomUUID(), 
        companyId, 
        bankId, 
        rawCompanyName: r.name, 
        category: r.category, 
        status: r.status, 
        remarks: r.remarks, 
        raw: r.raw 
      });
    }

    for (let i = 0; i < categoryRows.length; i += CHUNK) {
      const chunk = categoryRows.slice(i, i + CHUNK);
      try {
        // Find existing records to log them as skipped (for MERGE mode)
        if (importType === "MERGE") {
          const existingCats = await prisma.companyBankCategory.findMany({
            where: { bankId, companyId: { in: chunk.map(r => r.companyId) } },
            select: { companyId: true }
          });
          const existingSet = new Set(existingCats.map(c => c.companyId));
          
          chunk.forEach((r, ri) => {
            if (existingSet.has(r.companyId)) {
              skippedCount++;
              captureError(i + ri + 2, "SKIPPED_EXISTING", `Company already mapped to this bank (Merge Mode). Skipped.`, `companyId: ${r.companyId}`, undefined, r.raw);
            }
          });
        }

        const res = await prisma.companyBankCategory.createMany({
          data: chunk.map((r) => ({
            id: r.id,
            companyId: r.companyId,
            bankId: r.bankId,
            rawCompanyName: r.rawCompanyName,
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
          captureError(i + ri + 2, "CHUNK_FAILED", errMsg, `companyId: ${r.companyId}`, undefined, r.raw)
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

  if (mapping.pincode) {
    for (const row of rawRows) {
      const pin = (row[mapping.pincode] || "").trim();
      if (!pin || pin.length < 3 || seen.has(pin)) continue;
      seen.add(pin);
      validRowCount++;
    }
  } else {
    for (const row of rawRows) {
      const name = mapping.company_name ? (row[mapping.company_name] || "").trim() : "";
      if (!name || name.length < 2) continue;
      const norm = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      validRowCount++;
    }
  }

  return { validRowCount };
}

function normalizeCategory(raw: string): string {
  if (!raw) return "UNLISTED";
  const cat = raw.trim().toUpperCase();

  if (cat.includes("REJECT") || cat === "NL" || cat === "NOT LISTED" || cat === "BLACKLIST") return "REJECT";
  if (cat === "N/A" || cat === "NA" || cat === "") return "UNLISTED";

  return cat; // Preserve exact category values (e.g., SUPERPRIME, ELITE, OPENMARKET)
}

// ─── Pincode Background Processor ──────────────────────────────────────────────

async function processPincodeImportBackground(
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
  const errorBuffer: any[] = [];
  function captureError(rowNum: number, errorCode: string, errorMessage: string, rawData?: string, columnName?: string, rawJson?: any) {
    if (errorBuffer.length >= 1000) return;
    errorBuffer.push({ importJobId: historyId, rowNumber: rowNum, columnName, errorCode, errorMessage, rawData: rawData?.substring(0, 500), rawJson });
  }

  async function flushErrors() {
    if (errorBuffer.length === 0) return;
    try {
      await prisma.importError.createMany({ data: errorBuffer, skipDuplicates: true });
    } catch (e) {
      console.error(`[Import ${historyId}] Error flush failed:`, e);
    }
  }

  try {
    const now = new Date().toISOString();

    if (importType === "REPLACE") {
      await prisma.pincodeServiceability.deleteMany({ where: { bankId } });
    }

    const seen = new Set<string>();
    const validRows: any[] = [];
    let invalidCount = 0;
    let skippedCount = 0;

    for (let rowIdx = 0; rowIdx < rawRows.length; rowIdx++) {
      const row = rawRows[rowIdx];
      const rowNum = rowIdx + 2;

      const rawPin = mapping.pincode ? (row[mapping.pincode] || "").trim() : "";
      if (!rawPin || rawPin.length < 3) {
        invalidCount++;
        captureError(rowNum, "INVALID_PINCODE", "Pincode is missing or too short", rawPin, mapping.pincode, row);
        continue;
      }

      if (seen.has(rawPin)) {
        skippedCount++;
        continue; // Simple deduplication for now
      }
      seen.add(rawPin);

      // Parse booleans and other fields safely
      const rawState = mapping.state ? (row[mapping.state] || "").trim().substring(0, 50) : null;
      const rawCity = mapping.city ? (row[mapping.city] || "").trim().substring(0, 50) : null;
      const rawArea = mapping.area ? (row[mapping.area] || "").trim().substring(0, 100) : null;
      const rawCat = mapping.category ? (row[mapping.category] || "").trim().toUpperCase() : null;
      
      const servStr = mapping.serviceable ? (row[mapping.serviceable] || "").trim().toLowerCase() : "";
      const isServiceable = servStr === "yes" || servStr === "true" || servStr === "1" || servStr === "active" || servStr === "y";
      
      const negStr = mapping.negative ? (row[mapping.negative] || "").trim().toLowerCase() : "";
      const isNegative = negStr === "yes" || negStr === "true" || negStr === "1" || negStr === "y" || negStr === "negative";

      validRows.push({
        id: randomUUID(),
        bankId,
        pincode: rawPin,
        state: rawState,
        city: rawCity,
        area: rawArea,
        isServiceable: mapping.serviceable ? isServiceable : true,
        isNegative: mapping.negative ? isNegative : false,
        category: rawCat || "REGULAR"
      });
    }

    let processedCount = 0;
    let failedCount = 0;

    const CHUNK = 500;
    for (let i = 0; i < validRows.length; i += CHUNK) {
      const chunk = validRows.slice(i, i + CHUNK);
      try {
        const placeholders = chunk.map((r, idx) => `($${idx * 9 + 1},$${idx * 9 + 2},$${idx * 9 + 3},$${idx * 9 + 4},$${idx * 9 + 5},$${idx * 9 + 6},$${idx * 9 + 7},$${idx * 9 + 8},$${idx * 9 + 9})`).join(",");
        const values = chunk.flatMap(r => [r.id, r.bankId, r.pincode, r.state, r.city, r.area, r.isServiceable, r.isNegative, r.category]);
        
        await prisma.$executeRawUnsafe(`
          INSERT INTO "pincode_serviceabilities" ("id", "bankId", "pincode", "state", "city", "area", "isServiceable", "isNegative", "category")
          VALUES ${placeholders}
          ON CONFLICT ("bankId", "pincode") DO UPDATE SET
            "state" = EXCLUDED."state",
            "city" = EXCLUDED."city",
            "area" = EXCLUDED."area",
            "isServiceable" = EXCLUDED."isServiceable",
            "isNegative" = EXCLUDED."isNegative",
            "category" = EXCLUDED."category",
            "updatedAt" = '${now}'
        `, ...values);
        
        processedCount += chunk.length;
      } catch (err: any) {
        console.error(`[Import ${historyId}] Batch failed (Rows ${i}-${i + chunk.length}):`, err.message);
        failedCount += chunk.length;
      }
    }

    await flushErrors();

    await prisma.importHistory.update({
      where: { id: historyId },
      data: { status: "COMPLETED", processedRecords: processedCount, failedRecords: failedCount, skippedRecords: skippedCount }
    });

    await createAuditLog({
      userId, action: "EXCEL_IMPORTED", entity: "Bank", entityId: bankId,
      details: { fileName, importType: "PINCODE", totalRecords: rawRows.length, processedCount, failedCount, bankName }
    });

  } catch (err: any) {
    console.error(`[Import ${historyId}] Fatal Error:`, err);
    await flushErrors();
    await prisma.importHistory.update({
      where: { id: historyId },
      data: { status: "FAILED", errorMessage: err.message || "Import failed" }
    });
  }
}

// ─── Force Sync ─────────────────────────────────────────────────────────────

export async function forceSyncErrors(historyId: string, errorIds: string[], userId: string, forceSyncAll?: boolean, filterCode?: string) {
  const whereClause: any = { importJobId: historyId };
  if (!forceSyncAll) {
    whereClause.id = { in: errorIds };
  } else if (filterCode) {
    whereClause.errorCode = filterCode;
  }

  const history = await prisma.importHistory.findUnique({
    where: { id: historyId },
    include: { importErrors: { where: whereClause } }
  });

  if (!history) throw new Error("Import history not found");
  if (!history.mappingJson) throw new Error("No mapping config found for this import");

  const mapping = JSON.parse(history.mappingJson) as ConfirmedMapping;
  const isPincode = !!mapping.pincode;

  const validRows: any[] = [];
  const errorsToResolve: string[] = [];
  const now = new Date().toISOString();

  for (const err of history.importErrors) {
    if (!err.rawJson) continue;
    const row = err.rawJson as Record<string, string>;
    
    if (isPincode) {
      const rawPin = mapping.pincode ? (row[mapping.pincode] || "").trim() : "";
      if (!rawPin || rawPin.length < 3) continue; // Can't force if no pincode exists

      const rawState = mapping.state ? (row[mapping.state] || "").trim().substring(0, 50) : null;
      const rawCity = mapping.city ? (row[mapping.city] || "").trim().substring(0, 50) : null;
      const rawArea = mapping.area ? (row[mapping.area] || "").trim().substring(0, 100) : null;
      const rawCat = mapping.category ? (row[mapping.category] || "").trim().toUpperCase() : null;
      
      const servStr = mapping.serviceable ? (row[mapping.serviceable] || "").trim().toLowerCase() : "";
      const isServiceable = servStr === "yes" || servStr === "true" || servStr === "1" || servStr === "active" || servStr === "y";
      
      const negStr = mapping.negative ? (row[mapping.negative] || "").trim().toLowerCase() : "";
      const isNegative = negStr === "yes" || negStr === "true" || negStr === "1" || negStr === "y" || negStr === "negative";

      validRows.push({
        id: randomUUID(),
        bankId: history.bankId,
        pincode: rawPin,
        state: rawState,
        city: rawCity,
        area: rawArea,
        isServiceable: mapping.serviceable ? isServiceable : true,
        isNegative: mapping.negative ? isNegative : false,
        category: rawCat || "REGULAR"
      });
      errorsToResolve.push(err.id);

    } else {
      let rawName = mapping.company_name ? (row[mapping.company_name] || "").trim() : "";
      
      // If user is forcing it, and it has no name, we might give it a placeholder or skip
      if (!rawName || rawName.length < 2) {
        rawName = `UNKNOWN_${err.rowNumber}`;
      }
      
      const norm = normalizeCompanyName(rawName);
      if (!norm) continue; // Unsalvageable

      const rawCategory = mapping.category ? (row[mapping.category] || "").trim() : "";
      const rawStatus = mapping.status ? (row[mapping.status] || "").trim() : "";
      const rawCin = mapping.cin ? (row[mapping.cin] || "").trim() : "";
      const rawRemarks = mapping.remarks ? (row[mapping.remarks] || "").trim() : "";

      validRows.push({
        rawName,
        norm,
        category: normalizeCategory(rawCategory),
        status: rawStatus ? rawStatus.substring(0, 50) : "OPEN",
        cin: rawCin ? rawCin.substring(0, 100) : null,
        remarks: rawRemarks ? rawRemarks.substring(0, 1000) : null
      });
      errorsToResolve.push(err.id);
    }
  }

  let processedCount = 0;

  if (isPincode) {
    const CHUNK = 500;
    for (let i = 0; i < validRows.length; i += CHUNK) {
      const chunk = validRows.slice(i, i + CHUNK);
      const placeholders = chunk.map((r, idx) => `($${idx * 9 + 1},$${idx * 9 + 2},$${idx * 9 + 3},$${idx * 9 + 4},$${idx * 9 + 5},$${idx * 9 + 6},$${idx * 9 + 7},$${idx * 9 + 8},$${idx * 9 + 9})`).join(",");
      const values = chunk.flatMap(r => [r.id, r.bankId, r.pincode, r.state, r.city, r.area, r.isServiceable, r.isNegative, r.category]);
      
      await prisma.$executeRawUnsafe(`
        INSERT INTO "PincodeServiceability" ("id", "bankId", "pincode", "state", "city", "area", "isServiceable", "isNegative", "category")
        VALUES ${placeholders}
        ON CONFLICT ("bankId", "pincode") DO UPDATE SET
          "state" = EXCLUDED."state",
          "city" = EXCLUDED."city",
          "area" = EXCLUDED."area",
          "isServiceable" = EXCLUDED."isServiceable",
          "isNegative" = EXCLUDED."isNegative",
          "category" = EXCLUDED."category",
          "updatedAt" = '${now}'
      `, ...values);
      processedCount += chunk.length;
    }
  } else {
    // Process companies
    for (const r of validRows) {
      const company = await prisma.company.upsert({
        where: { normalizedName: r.norm },
        create: { name: r.rawName, normalizedName: r.norm },
        update: {},
      });
      
      await prisma.companyBankCategory.upsert({
        where: { companyId_bankId: { companyId: company.id, bankId: history.bankId } },
        create: { id: randomUUID(), companyId: company.id, bankId: history.bankId, category: r.category, status: r.status, remarks: r.remarks },
        update: { category: r.category, status: r.status, remarks: r.remarks, updatedAt: new Date() }
      });
      processedCount++;
    }
  }

  // Remove resolved errors and update stats
  if (errorsToResolve.length > 0) {
    await prisma.importError.deleteMany({
      where: { id: { in: errorsToResolve } }
    });
    
    await prisma.importHistory.update({
      where: { id: historyId },
      data: {
        processedRecords: { increment: processedCount },
        failedRecords: { decrement: errorsToResolve.length }
      }
    });
  }

  return { forceSynced: processedCount };
}

