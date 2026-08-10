/**
 * DIRECT IMPORT — IndusInd Bank Company List -Apr 2026.xlsb
 * Columns: Sr. No. | Name of the Company | Category | CIN NUMBER | Approval Date
 *
 * IndusInd Category Mapping:
 *   CAT A  → CAT A
 *   A+     → CAT A
 *   CAT G  → CAT A  (Government companies)
 *   Cat B / CAT B → CAT B
 *   CAT C1000     → CAT C
 *
 * Run: npx tsx scripts/import_indusind.ts
 */

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();
const FILE_PATH = "C:\\Users\\bhard\\Downloads\\Company List -Apr 2026.xlsb";
const BANK_CODE = "INDUSIND";
const CHUNK = 500;

function escapeSql(s: string) {
  return s.replace(/'/g, "''");
}

function normalizeCategory(raw: string): { category: string; status: string } {
  const c = (raw || "").trim().toUpperCase();

  if (c === "CAT A" || c === "A+" || c === "A" || c === "CAT G") return { category: "CAT A", status: "APPROVED" };
  if (c === "CAT B" || c === "CAT B" || c === "B") return { category: "CAT B", status: "APPROVED" };
  if (c === "CAT C1000" || c === "CAT C" || c === "C") return { category: "CAT C", status: "APPROVED" };
  if (c.includes("REJECT") || c === "NL" || c === "NOT LISTED") return { category: "REJECT", status: "REJECT" };
  if (c === "") return { category: "UNLISTED", status: "APPROVED" };

  return { category: c, status: "APPROVED" }; // preserve unknown
}

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  FINOLINK — IndusInd Bank Direct Import");
  console.log("═══════════════════════════════════════════════════════\n");

  // ── 1. Add IndusInd bank if not exists ───────────────────────────────────
  const bank = await prisma.bank.upsert({
    where: { code: BANK_CODE },
    update: { name: "IndusInd Bank", type: "BANK", isActive: true, partnerStatus: "ACTIVE", priority: 9, displayOrder: 9 },
    create: {
      name: "IndusInd Bank", code: BANK_CODE, type: "BANK",
      isActive: true, partnerStatus: "ACTIVE", priority: 9, displayOrder: 9,
      eligibility: "Salary > 25000, Age 21-60", processingFee: 1.5,
    },
  });
  console.log(`✅ Bank: ${bank.name} (${bank.id})`);

  // ── 2. Read xlsb ─────────────────────────────────────────────────────────
  console.log(`\n📂 Reading: ${FILE_PATH}`);
  const wb = XLSX.readFile(FILE_PATH, { type: "file" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });
  console.log(`   Total rows (incl. header): ${rawRows.length.toLocaleString()}`);
  // Columns: Sr.No.=0, Name=1, Category=2, CIN=3, Approval Date=4
  const NAME_COL = 1, CAT_COL = 2, CIN_COL = 3;

  // ── 3. Parse rows ─────────────────────────────────────────────────────────
  const seen = new Set<string>();
  const validRows: { id: string; name: string; normalizedName: string; cin: string | null; category: string; status: string }[] = [];

  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    const rawName = String(row[NAME_COL] || "").trim();
    if (!rawName || rawName.length < 2) continue;

    const norm = rawName.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);

    const rawCin = String(row[CIN_COL] || "").trim();
    const cin = rawCin && rawCin !== "0" && rawCin.length > 5 ? rawCin : null;
    const { category, status } = normalizeCategory(String(row[CAT_COL] || ""));

    validRows.push({ id: randomUUID(), name: rawName, normalizedName: norm, cin, category, status });
  }

  console.log(`\n📊 Parsed: ${validRows.length.toLocaleString()} unique companies`);
  const stats: Record<string, number> = {};
  for (const r of validRows) stats[r.category] = (stats[r.category] || 0) + 1;
  Object.entries(stats).sort((a, b) => b[1] - a[1])
    .forEach(([c, n]) => console.log(`     ${c}: ${n.toLocaleString()}`));

  // ── 4. Clear old mappings ─────────────────────────────────────────────────
  console.log(`\n🗑️  Clearing existing IndusInd mappings...`);
  const del = await prisma.companyBankCategory.deleteMany({ where: { bankId: bank.id } });
  console.log(`   Deleted ${del.count} old mappings`);

  // ── 5. Import history ─────────────────────────────────────────────────────
  const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (!admin) throw new Error("No SUPER_ADMIN found");
  const history = await prisma.importHistory.create({
    data: {
      bankId: bank.id, fileName: "Company List -Apr 2026.xlsb", importType: "REPLACE",
      totalRecords: validRows.length, processedRecords: 0, failedRecords: 0,
      status: "PROCESSING", createdById: admin.id,
    },
  });

  const now = new Date().toISOString();
  let processedCount = 0, failedCount = 0;

  // ── 6. Bulk INSERT companies ──────────────────────────────────────────────
  console.log(`\n🏢 Inserting ${validRows.length.toLocaleString()} companies...`);
  const t1 = Date.now();
  for (let i = 0; i < validRows.length; i += CHUNK) {
    const chunk = validRows.slice(i, i + CHUNK);
    try {
      const vals = chunk.map(r =>
        `('${r.id}','${escapeSql(r.name)}','${r.normalizedName}',${r.cin ? `'${escapeSql(r.cin)}'` : "NULL"},'${now}','${now}')`
      ).join(",");
      await prisma.$executeRawUnsafe(`INSERT OR IGNORE INTO companies (id, name, normalizedName, cin, createdAt, updatedAt) VALUES ${vals}`);
    } catch (err: any) { failedCount += chunk.length; console.error(`   ⚠️ Chunk err: ${err.message}`); }
    if ((i / CHUNK) % 20 === 0) {
      const done = Math.min(i + CHUNK, validRows.length);
      process.stdout.write(`\r   ${done.toLocaleString()}/${validRows.length.toLocaleString()} (${Math.round((done / validRows.length) * 100)}%)`);
    }
  }
  console.log(`\n   ✅ Done in ${Date.now() - t1}ms`);

  // ── 7. Fetch company IDs ──────────────────────────────────────────────────
  console.log(`\n🔍 Fetching company IDs...`);
  const t2 = Date.now();
  const companyMap = new Map<string, string>();
  const allNorms = validRows.map(r => r.normalizedName);
  for (let i = 0; i < allNorms.length; i += 900) {
    const found = await prisma.company.findMany({ where: { normalizedName: { in: allNorms.slice(i, i + 900) } }, select: { id: true, normalizedName: true } });
    for (const c of found) companyMap.set(c.normalizedName, c.id);
  }
  console.log(`   ✅ ${companyMap.size.toLocaleString()} IDs in ${Date.now() - t2}ms`);

  // ── 8. Bulk INSERT category mappings ──────────────────────────────────────
  console.log(`\n🏦 Inserting IndusInd category mappings...`);
  const t3 = Date.now();
  const catRows = validRows
    .map(r => ({ id: randomUUID(), companyId: companyMap.get(r.normalizedName), category: r.category, status: r.status }))
    .filter(r => r.companyId) as { id: string; companyId: string; category: string; status: string }[];

  for (let i = 0; i < catRows.length; i += CHUNK) {
    const chunk = catRows.slice(i, i + CHUNK);
    try {
      const vals = chunk.map(r =>
        `('${r.id}','${r.companyId}','${bank.id}','${escapeSql(r.category)}','${r.status}','IndusInd ${r.category} Tier','${now}')`
      ).join(",");
      await prisma.$executeRawUnsafe(`INSERT OR REPLACE INTO company_bank_categories (id, companyId, bankId, category, status, remarks, updatedAt) VALUES ${vals}`);
      processedCount += chunk.length;
    } catch (err: any) { failedCount += chunk.length; console.error(`   ⚠️ Cat chunk err: ${err.message}`); }
    if ((i / CHUNK) % 20 === 0) {
      const done = Math.min(i + CHUNK, catRows.length);
      process.stdout.write(`\r   ${done.toLocaleString()}/${catRows.length.toLocaleString()} (${Math.round((done / catRows.length) * 100)}%)`);
    }
  }
  console.log(`\n   ✅ Done in ${Date.now() - t3}ms`);

  // ── 9. Mark complete ──────────────────────────────────────────────────────
  await prisma.importHistory.update({ where: { id: history.id }, data: { status: "COMPLETED", processedRecords: processedCount, failedRecords: failedCount } });

  const totalCo = await prisma.company.count();
  const indusMaps = await prisma.companyBankCategory.count({ where: { bankId: bank.id } });

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  ✅ INDUSIND IMPORT COMPLETE");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Total Companies in DB:       ${totalCo.toLocaleString()}`);
  console.log(`  IndusInd Mappings in DB:     ${indusMaps.toLocaleString()}`);
  console.log(`  Processed:                   ${processedCount.toLocaleString()}`);
  console.log(`  Failed:                      ${failedCount.toLocaleString()}`);
  console.log("═══════════════════════════════════════════════════════\n");
}

main()
  .catch(err => { console.error("\n❌ Failed:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
