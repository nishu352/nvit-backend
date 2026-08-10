/**
 * Speed test: Insert 1000 companies using raw SQL bulk insert
 * and measure how fast it is vs individual upserts
 *
 * Run: npx tsx scripts/speed_test.ts
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

async function main() {
  console.log("⚡ Speed Test: Raw SQL bulk insert vs individual upserts\n");

  const ICICI_BANK_ID = "d3ab9f73-b93d-4c3f-aac4-d8f134c4142c";
  const now = new Date().toISOString();

  // ── Generate 1000 test companies ──────────────────────────────────────────
  const testRows = Array.from({ length: 1000 }, (_, i) => ({
    id: randomUUID(),
    name: `TEST COMPANY ${i + 1}`,
    normalizedName: `TESTCOMPANY${i + 1}`,
    cin: null,
    category: i % 3 === 0 ? "CAT A" : i % 3 === 1 ? "CAT B" : "CAT C",
    status: "APPROVED",
    remarks: null,
  }));

  // Clean any existing test data
  await prisma.$executeRawUnsafe(
    `DELETE FROM companies WHERE normalizedName LIKE 'TESTCOMPANY%'`
  );

  // ── METHOD 1: Raw SQL bulk INSERT (500 rows per statement) ────────────────
  console.log("Method 1: Raw SQL bulk INSERT (500 rows/statement)");
  const t1Start = Date.now();
  const CHUNK = 500;

  for (let i = 0; i < testRows.length; i += CHUNK) {
    const chunk = testRows.slice(i, i + CHUNK);
    const placeholders = chunk
      .map(
        (r) =>
          `('${r.id}','${r.name.replace(/'/g, "''")}','${r.normalizedName}',NULL,'${now}','${now}')`
      )
      .join(",");
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO companies (id, name, normalizedName, cin, createdAt, updatedAt) VALUES ${placeholders}`
    );
  }

  const t1End = Date.now();
  const count1 = await prisma.company.count({
    where: { normalizedName: { startsWith: "TESTCOMPANY" } },
  });
  console.log(`  ✅ Inserted ${count1} companies in ${t1End - t1Start}ms\n`);

  // Clean
  await prisma.$executeRawUnsafe(
    `DELETE FROM companies WHERE normalizedName LIKE 'TESTCOMPANY%'`
  );

  // ── METHOD 2: Individual Prisma upserts for comparison ───────────────────
  console.log("Method 2: Individual Prisma upserts (sequential, 100 rows only)");
  const sampleRows = testRows.slice(0, 100);
  const t2Start = Date.now();

  for (const r of sampleRows) {
    await prisma.company.upsert({
      where: { normalizedName: r.normalizedName },
      update: { name: r.name },
      create: {
        name: r.name,
        normalizedName: r.normalizedName,
        cin: null,
      },
    });
  }

  const t2End = Date.now();
  const t2Duration = t2End - t2Start;
  console.log(`  Inserted 100 companies in ${t2Duration}ms`);
  console.log(`  Projected for 1000 rows: ~${t2Duration * 10}ms`);
  console.log(`  Projected for 70,621 rows: ~${Math.round((t2Duration / 100) * 70621 / 1000)}s\n`);

  // Clean
  await prisma.$executeRawUnsafe(
    `DELETE FROM companies WHERE normalizedName LIKE 'TESTCOMPANY%'`
  );

  console.log("─────────────────────────────────────────────────────────");
  console.log(`Speedup ratio: ~${Math.round((t2Duration * 10) / (t1End - t1Start))}x faster with raw SQL`);
  console.log("─────────────────────────────────────────────────────────");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
