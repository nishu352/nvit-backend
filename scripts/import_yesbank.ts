/**
 * DIRECT IMPORT SCRIPT — Yes Bank company list.csv → Database
 * File: C:\Users\bhard\Downloads\company list\company list.csv
 * Columns: Name, Classification__c, Approval_Status__c, CIN__c
 *
 * Yes Bank category mapping:
 *   Gold        → CAT A
 *   Silver      → CAT B
 *   Silver Neo  → CAT B
 *   Not Qualified / Rejected → REJECT
 *
 * Run: npx tsx scripts/import_yesbank.ts
 */

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();
const CSV_PATH = "C:\\Users\\bhard\\Downloads\\company list\\company list.csv";
const BANK_CODE = "YESBANK";
const CHUNK_SIZE = 500;

function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

function normalizeCategory(raw: string): { category: string; status: string } {
  const cat = (raw || "").trim().toUpperCase();

  if (cat === "GOLD" || cat === "PLATINUM" || cat === "DIAMOND") return { category: "CAT A", status: "APPROVED" };
  if (cat === "SILVER" || cat === "SILVER NEO" || cat === "SILVER NEO" || cat === "BRONZE") return { category: "CAT B", status: "APPROVED" };
  if (cat === "NOT QUALIFIED" || cat === "NOTQUALIFIED" || cat === "REJECT" || cat.includes("REJECT")) return { category: "REJECT", status: "REJECT" };
  if (cat === "OPEN MARKET" || cat === "GENERAL" || cat === "") return { category: "CAT C", status: "APPROVED" };

  // CAT A/B/C passthrough
  if (cat === "CAT A" || cat === "A") return { category: "CAT A", status: "APPROVED" };
  if (cat === "CAT B" || cat === "B") return { category: "CAT B", status: "APPROVED" };
  if (cat === "CAT C" || cat === "C") return { category: "CAT C", status: "APPROVED" };

  return { category: cat, status: "APPROVED" }; // preserve unknown as-is
}

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  FINOLINK — Yes Bank Direct Import Script");
  console.log("═══════════════════════════════════════════════════════\n");

  // ── 1. Find Yes Bank ─────────────────────────────────────────────────────
  const bank = await prisma.bank.findUnique({ where: { code: BANK_CODE } });
  if (!bank) throw new Error(`Bank "${BANK_CODE}" not found. Run add_yesbank.ts first.`);
  console.log(`✅ Bank: ${bank.name} (${bank.id})`);

  // ── 2. Read & Parse CSV ──────────────────────────────────────────────────
  console.log(`\n📂 Reading: ${CSV_PATH}`);
  const workbook = XLSX.readFile(CSV_PATH, { raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
  console.log(`   Total rows (incl. header): ${rawRows.length}`);

  // Detect columns from header row [0]
  const header = rawRows[0] as string[];
  const nameCol = header.findIndex((h) => /name/i.test(String(h || "").trim()));
  const catCol = header.findIndex((h) => /class|category|tier|type/i.test(String(h || "").trim()));
  const statusCol = header.findIndex((h) => /status|approval/i.test(String(h || "").trim()));
  const cinCol = header.findIndex((h) => /cin|reg/i.test(String(h || "").trim()));

  console.log(`   Columns → Name:${nameCol}, Category:${catCol}, Status:${statusCol}, CIN:${cinCol}`);

  // ── 3. Parse valid rows ──────────────────────────────────────────────────
  const seen = new Set<string>();
  const validRows: {
    id: string;
    name: string;
    normalizedName: string;
    cin: string | null;
    category: string;
    status: string;
  }[] = [];

  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r] as string[];
    const rawName = String(row[nameCol] || "").trim();
    if (!rawName || rawName.length < 2) continue;
    if (/^name$/i.test(rawName)) continue; // skip repeat headers

    const norm = rawName.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);

    const rawCat = catCol >= 0 ? String(row[catCol] || "").trim() : "";
    const rawStatus = statusCol >= 0 ? String(row[statusCol] || "").trim().toUpperCase() : "APPROVED";
    const cin = cinCol >= 0 ? String(row[cinCol] || "").trim() || null : null;

    const { category, status } = normalizeCategory(rawCat);

    // If explicitly Rejected via status column, override
    const finalStatus =
      rawStatus.includes("REJECT") || rawStatus.includes("BLOCK") || status === "REJECT"
        ? "REJECT"
        : "APPROVED";

    validRows.push({
      id: randomUUID(),
      name: rawName,
      normalizedName: norm,
      cin: cin && cin.length > 2 ? cin : null,
      category,
      status: finalStatus,
    });
  }

  console.log(`\n📊 Parsed: ${validRows.length.toLocaleString()} unique companies`);

  // Category summary
  const catStats: Record<string, number> = {};
  for (const r of validRows) catStats[r.category] = (catStats[r.category] || 0) + 1;
  console.log("   Category distribution:");
  Object.entries(catStats).sort((a, b) => b[1] - a[1])
    .forEach(([c, n]) => console.log(`     ${c}: ${n.toLocaleString()}`));

  // ── 4. Clear old Yes Bank mappings ───────────────────────────────────────
  console.log(`\n🗑️  Clearing existing Yes Bank mappings...`);
  const deleted = await prisma.companyBankCategory.deleteMany({ where: { bankId: bank.id } });
  console.log(`   Deleted ${deleted.count} old mappings`);

  // ── 5. Create ImportHistory record ───────────────────────────────────────
  const adminUser = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (!adminUser) throw new Error("No SUPER_ADMIN user found");

  const history = await prisma.importHistory.create({
    data: {
      bankId: bank.id,
      fileName: "company list.csv",
      importType: "REPLACE",
      totalRecords: validRows.length,
      processedRecords: 0,
      failedRecords: 0,
      status: "PROCESSING",
      createdById: adminUser.id,
    },
  });

  const now = new Date().toISOString();
  let processedCount = 0;
  let failedCount = 0;

  // ── 6. Bulk INSERT OR IGNORE companies ───────────────────────────────────
  console.log(`\n🏢 Inserting ${validRows.length.toLocaleString()} companies...`);
  const t1 = Date.now();

  for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
    const chunk = validRows.slice(i, i + CHUNK_SIZE);
    try {
      const vals = chunk
        .map((r) =>
          `('${r.id}','${escapeSql(r.name)}','${r.normalizedName}',${r.cin ? `'${escapeSql(r.cin)}'` : "NULL"},'${now}','${now}')`
        )
        .join(",");
      await prisma.$executeRawUnsafe(
        `INSERT OR IGNORE INTO companies (id, name, normalizedName, cin, createdAt, updatedAt) VALUES ${vals}`
      );
    } catch (err: any) {
      console.error(`   ⚠️  Chunk ${Math.floor(i / CHUNK_SIZE) + 1} error: ${err.message}`);
      failedCount += chunk.length;
    }

    if ((i / CHUNK_SIZE) % 20 === 0) {
      const done = Math.min(i + CHUNK_SIZE, validRows.length);
      process.stdout.write(`\r   ${done.toLocaleString()}/${validRows.length.toLocaleString()} (${Math.round((done / validRows.length) * 100)}%)`);
    }
  }
  console.log(`\n   ✅ Done in ${Date.now() - t1}ms`);

  // ── 7. Fetch all company IDs ──────────────────────────────────────────────
  console.log(`\n🔍 Fetching company IDs...`);
  const t2 = Date.now();
  const companyMap = new Map<string, string>();
  const allNorms = validRows.map((r) => r.normalizedName);

  for (let i = 0; i < allNorms.length; i += 900) {
    const slice = allNorms.slice(i, i + 900);
    const found = await prisma.company.findMany({
      where: { normalizedName: { in: slice } },
      select: { id: true, normalizedName: true },
    });
    for (const c of found) companyMap.set(c.normalizedName, c.id);
  }
  console.log(`   ✅ ${companyMap.size.toLocaleString()} IDs fetched in ${Date.now() - t2}ms`);

  // ── 8. Bulk INSERT OR REPLACE category mappings ───────────────────────────
  console.log(`\n🏦 Inserting Yes Bank category mappings...`);
  const t3 = Date.now();

  const catRows: { id: string; companyId: string; category: string; status: string; remarks: string | null }[] = [];
  for (const r of validRows) {
    const companyId = companyMap.get(r.normalizedName);
    if (!companyId) continue;
    catRows.push({
      id: randomUUID(),
      companyId,
      category: r.category,
      status: r.status,
      remarks: `Yes Bank ${r.category} Classification`,
    });
  }

  for (let i = 0; i < catRows.length; i += CHUNK_SIZE) {
    const chunk = catRows.slice(i, i + CHUNK_SIZE);
    try {
      const vals = chunk
        .map((r) =>
          `('${r.id}','${r.companyId}','${bank.id}','${escapeSql(r.category)}','${r.status}','${escapeSql(r.remarks || "")}','${now}')`
        )
        .join(",");
      await prisma.$executeRawUnsafe(
        `INSERT OR REPLACE INTO company_bank_categories (id, companyId, bankId, category, status, remarks, updatedAt) VALUES ${vals}`
      );
      processedCount += chunk.length;
    } catch (err: any) {
      console.error(`   ⚠️  Cat chunk error: ${err.message}`);
      failedCount += chunk.length;
    }

    if ((i / CHUNK_SIZE) % 20 === 0) {
      const done = Math.min(i + CHUNK_SIZE, catRows.length);
      process.stdout.write(`\r   ${done.toLocaleString()}/${catRows.length.toLocaleString()} (${Math.round((done / catRows.length) * 100)}%)`);
    }
  }
  console.log(`\n   ✅ Done in ${Date.now() - t3}ms`);

  // ── 9. Mark COMPLETED ────────────────────────────────────────────────────
  await prisma.importHistory.update({
    where: { id: history.id },
    data: { status: "COMPLETED", processedRecords: processedCount, failedRecords: failedCount },
  });

  // ── 10. Final report ─────────────────────────────────────────────────────
  const totalCompanies = await prisma.company.count();
  const yesMappings = await prisma.companyBankCategory.count({ where: { bankId: bank.id } });

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  ✅ YES BANK IMPORT COMPLETE");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Total Companies in DB:    ${totalCompanies.toLocaleString()}`);
  console.log(`  Yes Bank Mappings in DB:  ${yesMappings.toLocaleString()}`);
  console.log(`  Processed:                ${processedCount.toLocaleString()}`);
  console.log(`  Failed:                   ${failedCount.toLocaleString()}`);
  console.log("═══════════════════════════════════════════════════════\n");
}

main()
  .catch((err) => { console.error("\n❌ Import failed:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
