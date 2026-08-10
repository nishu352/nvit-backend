/**
 * DIRECT IMPORT SCRIPT — ICICI.xlsx → Database
 * Bypasses the admin UI and imports directly using raw SQL bulk inserts.
 *
 * Run: npx tsx scripts/import_icici.ts
 */

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

const ICICI_FILE_PATH = "C:\\Users\\bhard\\Videos\\ICICI.xlsx";
const BANK_CODE = "ICICI";
const CHUNK_SIZE = 500;

function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

function normalizeCategory(raw: string): string {
  if (!raw) return "UNLISTED";
  const cat = raw.trim().toUpperCase();

  if (cat === "CAT A" || cat === "A") return "CAT A";
  if (cat === "CAT B" || cat === "B") return "CAT B";
  if (cat === "CAT C" || cat === "C") return "CAT C";
  if (cat === "SUPERPRIME" || cat === "SUPER PRIME") return "CAT A";
  if (cat === "ELITE") return "CAT A";
  if (cat === "PREFERRED" || cat === "PRIME") return "CAT B";
  if (cat === "OPEN MARKET" || cat === "OPENMARKET" || cat === "OPEN-MARKET") return "CAT C";
  if (cat === "GOVERNMENT" || cat === "GOVT" || cat === "GOV") return "CAT A";
  if (cat === "PSU" || cat.includes("PUBLIC SECTOR")) return "CAT A";
  if (cat === "MNC" || cat.includes("MULTI NATIONAL")) return "CAT A";
  if (cat.includes("REJECT") || cat === "NL" || cat === "NOT LISTED") return "REJECT";
  if (cat === "UNLISTED" || cat === "N/A" || cat === "NA") return "UNLISTED";

  return cat; // preserve as-is (e.g. "PREFERRED", "SUPERPRIME" etc.)
}

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  FINOLINK — ICICI Direct Import Script");
  console.log("═══════════════════════════════════════════════════════\n");

  // ── 1. Find ICICI bank ───────────────────────────────────────────────────
  const bank = await prisma.bank.findUnique({ where: { code: BANK_CODE } });
  if (!bank) {
    throw new Error(`Bank with code "${BANK_CODE}" not found in database.`);
  }
  console.log(`✅ Bank found: ${bank.name} (${bank.id})`);

  // ── 2. Read & parse ICICI.xlsx ───────────────────────────────────────────
  console.log(`\n📂 Reading: ${ICICI_FILE_PATH}`);
  const workbook = XLSX.readFile(ICICI_FILE_PATH);
  const sheetName = workbook.SheetNames[0];
  console.log(`   Sheet: "${sheetName}"`);

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
  console.log(`   Total rows (incl. header): ${rawRows.length}`);

  // Detect header row
  let headerRowIndex = 0;
  let companyColIndex = -1;
  let categoryColIndex = -1;

  for (let r = 0; r < Math.min(10, rawRows.length); r++) {
    const row = rawRows[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || "").trim().toLowerCase();
      if (/company\s*name|company|employer/.test(cell) && companyColIndex === -1) {
        companyColIndex = c;
        headerRowIndex = r;
      }
      if (/category|cat|tier|policy/.test(cell) && categoryColIndex === -1) {
        categoryColIndex = c;
      }
    }
    if (companyColIndex !== -1) break;
  }

  console.log(`   Header row: ${headerRowIndex}, Company col: ${companyColIndex}, Category col: ${categoryColIndex}`);

  // Parse valid rows
  const seen = new Set<string>();
  const validRows: {
    id: string;
    name: string;
    normalizedName: string;
    category: string;
    status: string;
  }[] = [];

  for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!Array.isArray(row)) continue;
    const rawName = String(row[companyColIndex] || "").trim();
    if (!rawName || rawName.length < 2) continue;
    if (/company\s*name|sr\.?\s*no/i.test(rawName)) continue;

    const norm = rawName.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);

    const rawCat = categoryColIndex >= 0 ? String(row[categoryColIndex] || "").trim() : "";
    const category = normalizeCategory(rawCat || "UNLISTED");
    const status = category === "REJECT" ? "REJECT" : "APPROVED";

    validRows.push({ id: randomUUID(), name: rawName, normalizedName: norm, category, status });
  }

  console.log(`\n📊 Parsed: ${validRows.length.toLocaleString()} unique companies`);

  // Category summary
  const catStats: Record<string, number> = {};
  for (const r of validRows) {
    catStats[r.category] = (catStats[r.category] || 0) + 1;
  }
  console.log("   Category distribution:");
  Object.entries(catStats)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, cnt]) => console.log(`     ${cat}: ${cnt.toLocaleString()}`));

  // ── 3. Clear existing ICICI mappings (REPLACE mode) ──────────────────────
  console.log(`\n🗑️  Clearing existing ICICI mappings...`);
  const deleted = await prisma.companyBankCategory.deleteMany({ where: { bankId: bank.id } });
  console.log(`   Deleted ${deleted.count} old mappings`);

  // ── 4. Create ImportHistory record ───────────────────────────────────────
  const adminUser = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (!adminUser) throw new Error("No SUPER_ADMIN user found in database");

  const history = await prisma.importHistory.create({
    data: {
      bankId: bank.id,
      fileName: "ICICI.xlsx",
      importType: "REPLACE",
      totalRecords: validRows.length,
      processedRecords: 0,
      failedRecords: 0,
      status: "PROCESSING",
      createdById: adminUser.id,
    },
  });
  console.log(`\n📝 Import history created: ${history.id}`);

  const now = new Date().toISOString();
  let processedCount = 0;
  let failedCount = 0;
  const totalChunks = Math.ceil(validRows.length / CHUNK_SIZE);

  // ── 5. Bulk INSERT OR IGNORE companies ───────────────────────────────────
  console.log(`\n🏢 Inserting companies (${totalChunks} chunks of ${CHUNK_SIZE})...`);
  const companyInsertStart = Date.now();

  for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
    const chunk = validRows.slice(i, i + CHUNK_SIZE);
    try {
      const placeholders = chunk
        .map(
          (r) =>
            `('${r.id}','${escapeSql(r.name)}','${r.normalizedName}',NULL,'${now}','${now}')`
        )
        .join(",");
      await prisma.$executeRawUnsafe(
        `INSERT OR IGNORE INTO companies (id, name, normalizedName, cin, createdAt, updatedAt) VALUES ${placeholders}`
      );
    } catch (err: any) {
      console.error(`   ⚠️  Chunk ${Math.floor(i / CHUNK_SIZE) + 1} failed: ${err.message}`);
      failedCount += chunk.length;
    }

    // Progress log every 20 chunks
    if ((i / CHUNK_SIZE) % 20 === 0) {
      const done = Math.min(i + CHUNK_SIZE, validRows.length);
      const pct = Math.round((done / validRows.length) * 100);
      process.stdout.write(`\r   Progress: ${done.toLocaleString()}/${validRows.length.toLocaleString()} (${pct}%)`);
    }
  }
  console.log(`\n   ✅ Companies inserted in ${Date.now() - companyInsertStart}ms`);

  // ── 6. Fetch all company IDs ──────────────────────────────────────────────
  console.log(`\n🔍 Fetching company IDs from DB...`);
  const fetchStart = Date.now();
  const companyMap = new Map<string, string>();
  const allNormNames = validRows.map((r) => r.normalizedName);

  for (let i = 0; i < allNormNames.length; i += 900) {
    const nameChunk = allNormNames.slice(i, i + 900);
    const companies = await prisma.company.findMany({
      where: { normalizedName: { in: nameChunk } },
      select: { id: true, normalizedName: true },
    });
    for (const c of companies) companyMap.set(c.normalizedName, c.id);
  }
  console.log(`   ✅ Fetched ${companyMap.size.toLocaleString()} company IDs in ${Date.now() - fetchStart}ms`);

  // ── 7. Bulk INSERT OR REPLACE category mappings ───────────────────────────
  console.log(`\n🏦 Inserting ICICI category mappings...`);
  const catInsertStart = Date.now();

  const categoryRows: { id: string; companyId: string; category: string; status: string }[] = [];
  for (const r of validRows) {
    const companyId = companyMap.get(r.normalizedName);
    if (!companyId) continue;
    categoryRows.push({ id: randomUUID(), companyId, category: r.category, status: r.status });
  }

  const catChunks = Math.ceil(categoryRows.length / CHUNK_SIZE);
  for (let i = 0; i < categoryRows.length; i += CHUNK_SIZE) {
    const chunk = categoryRows.slice(i, i + CHUNK_SIZE);
    try {
      const placeholders = chunk
        .map(
          (r) =>
            `('${r.id}','${r.companyId}','${bank.id}','${r.category}','${r.status}',NULL,'${now}')`
        )
        .join(",");
      await prisma.$executeRawUnsafe(
        `INSERT OR REPLACE INTO company_bank_categories (id, companyId, bankId, category, status, remarks, updatedAt) VALUES ${placeholders}`
      );
      processedCount += chunk.length;
    } catch (err: any) {
      console.error(`   ⚠️  Category chunk failed: ${err.message}`);
      failedCount += chunk.length;
    }

    if ((i / CHUNK_SIZE) % 20 === 0) {
      const done = Math.min(i + CHUNK_SIZE, categoryRows.length);
      const pct = Math.round((done / categoryRows.length) * 100);
      process.stdout.write(`\r   Progress: ${done.toLocaleString()}/${categoryRows.length.toLocaleString()} (${pct}%)`);
    }
  }
  console.log(`\n   ✅ Category mappings inserted in ${Date.now() - catInsertStart}ms`);

  // ── 8. Mark import COMPLETED ──────────────────────────────────────────────
  await prisma.importHistory.update({
    where: { id: history.id },
    data: { status: "COMPLETED", processedRecords: processedCount, failedRecords: failedCount },
  });

  // ── 9. Final verification ─────────────────────────────────────────────────
  const finalCompanies = await prisma.company.count();
  const finalMappings = await prisma.companyBankCategory.count({ where: { bankId: bank.id } });

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  ✅ IMPORT COMPLETE");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Companies in DB:      ${finalCompanies.toLocaleString()}`);
  console.log(`  ICICI Mappings in DB: ${finalMappings.toLocaleString()}`);
  console.log(`  Processed:            ${processedCount.toLocaleString()}`);
  console.log(`  Failed:               ${failedCount.toLocaleString()}`);
  console.log("═══════════════════════════════════════════════════════\n");
}

main()
  .catch((err) => {
    console.error("\n❌ Import failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
