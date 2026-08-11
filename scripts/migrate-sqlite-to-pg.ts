#!/usr/bin/env tsx
/**
 * FINOLINK — SQLite → Supabase PostgreSQL Migration (FAST VERSION)
 *
 * Uses createMany + skipDuplicates for bulk inserts — orders of magnitude
 * faster than row-by-row upserts. Safe to re-run.
 *
 * Run: npm run db:migrate
 */

import initSqlJs from "sql.js";
import { readFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const SQLITE_PATH = path.resolve(__dirname, "../prisma/dev.db");
const CHUNK = 1000; // rows per bulk INSERT statement

const pg = new PrismaClient();

interface Result { table: string; sqlite: number; inserted: number; skipped: number; errors: number; }
const results: Result[] = [];

function log(msg: string) { process.stdout.write(`[${new Date().toLocaleTimeString("en-IN")}] ${msg}\n`); }
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
function parseBool(v: any, def = false): boolean {
  if (v === null || v === undefined) return def;
  if (typeof v === "number") return v !== 0;
  return Boolean(v);
}
function parseDate(v: any): Date {
  if (!v) return new Date();
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? new Date() : d;
}
function parseJson(v: any): any {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v as string); } catch { return null; }
}

async function openSQLite() {
  log("Loading sql.js...");
  const SQL = await initSqlJs();
  const buf = readFileSync(SQLITE_PATH);
  log(`✅ SQLite opened (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  return new SQL.Database(buf);
}

function readTable(db: any, table: string): Record<string, any>[] {
  try {
    const stmt = db.prepare(`SELECT * FROM "${table}"`);
    const rows: Record<string, any>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch (e: any) {
    log(`⚠️  Table '${table}' not found — skipping`);
    return [];
  }
}

async function pgCount(model: any) {
  try { return await model.count(); } catch { return 0; }
}

// ─── Users ────────────────────────────────────────────────────────────────────
async function migrateUsers(db: any) {
  const rows = readTable(db, "users");
  log(`  users: ${rows.length} rows in SQLite`);
  let inserted = 0, errors = 0;
  for (const batch of chunk(rows, CHUNK)) {
    try {
      const res = await pg.user.createMany({
        skipDuplicates: true,
        data: batch.map(r => ({
          id: r.id, email: r.email, password: r.password, name: r.name,
          role: r.role || "USER", isActive: parseBool(r.isActive, true),
          createdAt: parseDate(r.createdAt), updatedAt: parseDate(r.updatedAt),
        })),
      });
      inserted += res.count;
    } catch (e: any) { errors++; console.error("  users batch error:", e.message); }
  }
  const after = await pgCount(pg.user);
  results.push({ table: "users", sqlite: rows.length, inserted, skipped: rows.length - inserted - errors, errors });
  log(`  ✔ users: ${inserted} inserted, ${after} total in PG`);
}

// ─── Banks ────────────────────────────────────────────────────────────────────
async function migrateBanks(db: any) {
  const rows = readTable(db, "banks");
  log(`  banks: ${rows.length} rows in SQLite`);
  let inserted = 0, errors = 0;
  for (const batch of chunk(rows, CHUNK)) {
    try {
      const res = await pg.bank.createMany({
        skipDuplicates: true,
        data: batch.map(r => ({
          id: r.id, name: r.name, code: r.code, type: r.type || "BANK",
          logoUrl: r.logoUrl || null, isActive: parseBool(r.isActive, true),
          priority: Number(r.priority ?? 0), partnerStatus: r.partnerStatus || "ACTIVE",
          policyPdfUrl: r.policyPdfUrl || null, displayOrder: Number(r.displayOrder ?? 0),
          eligibility: r.eligibility || null, processingFee: Number(r.processingFee ?? 0),
          createdAt: parseDate(r.createdAt), updatedAt: parseDate(r.updatedAt),
        })),
      });
      inserted += res.count;
    } catch (e: any) { errors++; console.error("  banks batch error:", e.message); }
  }
  results.push({ table: "banks", sqlite: rows.length, inserted, skipped: rows.length - inserted - errors, errors });
  log(`  ✔ banks: ${inserted} inserted`);
}

// ─── Companies ────────────────────────────────────────────────────────────────
async function migrateCompanies(db: any) {
  const rows = readTable(db, "companies");
  log(`  companies: ${rows.length.toLocaleString()} rows in SQLite — bulk inserting...`);
  let inserted = 0, errors = 0;
  const batches = chunk(rows, CHUNK);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const res = await pg.company.createMany({
        skipDuplicates: true,
        data: batch.map(r => ({
          id: r.id, name: r.name, normalizedName: r.normalizedName,
          cin: r.cin || null, pincode: r.pincode || null, city: r.city || null,
          state: r.state || null, district: r.district || null, status: r.status || "ACTIVE",
          createdAt: parseDate(r.createdAt), updatedAt: parseDate(r.updatedAt),
        })),
      });
      inserted += res.count;
    } catch (e: any) { errors++; }

    if ((i + 1) % 20 === 0 || i === batches.length - 1) {
      log(`  companies: ${((i + 1) * CHUNK).toLocaleString()} / ${rows.length.toLocaleString()} processed, ${inserted.toLocaleString()} inserted...`);
    }
  }
  results.push({ table: "companies", sqlite: rows.length, inserted, skipped: rows.length - inserted - errors, errors });
  log(`  ✔ companies: ${inserted.toLocaleString()} inserted`);
}

// ─── Company Bank Categories ──────────────────────────────────────────────────
async function migrateCategories(db: any) {
  const rows = readTable(db, "company_bank_categories");
  log(`  company_bank_categories: ${rows.length.toLocaleString()} rows in SQLite...`);
  let inserted = 0, errors = 0;
  for (const batch of chunk(rows, CHUNK)) {
    try {
      const res = await pg.companyBankCategory.createMany({
        skipDuplicates: true,
        data: batch.map(r => ({
          id: r.id, companyId: r.companyId, bankId: r.bankId,
          category: r.category || "UNLISTED", status: r.status || "APPROVED",
          remarks: r.remarks || null, source: r.source || "IMPORT",
          createdAt: parseDate(r.createdAt ?? r.updatedAt), updatedAt: parseDate(r.updatedAt),
        })),
      });
      inserted += res.count;
    } catch (e: any) { errors++; }
  }
  results.push({ table: "company_bank_categories", sqlite: rows.length, inserted, skipped: rows.length - inserted - errors, errors });
  log(`  ✔ company_bank_categories: ${inserted.toLocaleString()} inserted`);
}

// ─── Pincodes ─────────────────────────────────────────────────────────────────
async function migratePincodes(db: any) {
  const rows = readTable(db, "pincode_serviceabilities");
  log(`  pincode_serviceabilities: ${rows.length.toLocaleString()} rows...`);
  let inserted = 0, errors = 0;
  for (const batch of chunk(rows, CHUNK)) {
    try {
      const res = await pg.pincodeServiceability.createMany({
        skipDuplicates: true,
        data: batch.map(r => ({
          id: r.id, bankId: r.bankId, pincode: r.pincode,
          state: r.state || null, city: r.city || null, area: r.area || null,
          isServiceable: parseBool(r.isServiceable, true), isNegative: parseBool(r.isNegative, false),
          category: r.category || null, updatedAt: parseDate(r.updatedAt),
        })),
      });
      inserted += res.count;
    } catch (e: any) { errors++; }
  }
  results.push({ table: "pincode_serviceabilities", sqlite: rows.length, inserted, skipped: rows.length - inserted - errors, errors });
  log(`  ✔ pincodes: ${inserted.toLocaleString()} inserted`);
}

// ─── Loan Applications ────────────────────────────────────────────────────────
async function migrateLeads(db: any) {
  const rows = readTable(db, "loan_applications");
  log(`  loan_applications: ${rows.length} rows...`);
  let inserted = 0, errors = 0;
  for (const batch of chunk(rows, CHUNK)) {
    try {
      const res = await pg.loanApplication.createMany({
        skipDuplicates: true,
        data: batch.map(r => ({
          id: r.id, name: r.name, mobile: r.mobile, email: r.email,
          city: r.city, state: r.state, company: r.company,
          monthlyIncome: Number(r.monthlyIncome ?? 0), loanType: r.loanType,
          loanAmount: Number(r.loanAmount ?? 0), remarks: r.remarks || null,
          status: r.status || "FRESH", assignedExecutiveId: r.assignedExecutiveId || null,
          source: r.source || "WEBSITE",
          timeline: parseJson(r.timeline), internalNotes: parseJson(r.internalNotes),
          attachments: parseJson(r.attachments), reminders: parseJson(r.reminders),
          followUps: parseJson(r.followUps),
          createdAt: parseDate(r.createdAt), updatedAt: parseDate(r.updatedAt),
        })),
      });
      inserted += res.count;
    } catch (e: any) { errors++; }
  }
  results.push({ table: "loan_applications", sqlite: rows.length, inserted, skipped: rows.length - inserted - errors, errors });
  log(`  ✔ leads: ${inserted} inserted`);
}

// ─── Import Histories ─────────────────────────────────────────────────────────
async function migrateImportHistories(db: any) {
  const rows = readTable(db, "import_histories");
  log(`  import_histories: ${rows.length} rows...`);
  let inserted = 0, errors = 0;
  for (const batch of chunk(rows, CHUNK)) {
    try {
      const res = await pg.importHistory.createMany({
        skipDuplicates: true,
        data: batch.map(r => ({
          id: r.id, bankId: r.bankId, fileName: r.fileName,
          fileHash: r.fileHash || null, importType: r.importType || "MERGE",
          totalRecords: Number(r.totalRecords ?? 0), processedRecords: Number(r.processedRecords ?? 0),
          skippedRecords: Number(r.skippedRecords ?? 0), failedRecords: Number(r.failedRecords ?? 0),
          status: r.status || "COMPLETED", errorMessage: r.errorMessage || null,
          mappingJson: r.mappingJson || null, createdById: r.createdById,
          createdAt: parseDate(r.createdAt), updatedAt: parseDate(r.updatedAt),
        })),
      });
      inserted += res.count;
    } catch (e: any) { errors++; }
  }
  results.push({ table: "import_histories", sqlite: rows.length, inserted, skipped: rows.length - inserted - errors, errors });
  log(`  ✔ import_histories: ${inserted} inserted`);
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────
async function migrateAuditLogs(db: any) {
  const rows = readTable(db, "audit_logs");
  log(`  audit_logs: ${rows.length.toLocaleString()} rows...`);
  let inserted = 0, errors = 0;
  for (const batch of chunk(rows, CHUNK)) {
    try {
      const res = await pg.auditLog.createMany({
        skipDuplicates: true,
        data: batch.map(r => ({
          id: r.id, userId: r.userId || null, userEmail: r.userEmail || null,
          action: r.action, entity: r.entity, entityId: r.entityId || null,
          details: r.details || null, ipAddress: r.ipAddress || null,
          createdAt: parseDate(r.createdAt),
        })),
      });
      inserted += res.count;
    } catch (e: any) { errors++; }
  }
  results.push({ table: "audit_logs", sqlite: rows.length, inserted, skipped: rows.length - inserted - errors, errors });
  log(`  ✔ audit_logs: ${inserted.toLocaleString()} inserted`);
}

// ─── Bank Policies ────────────────────────────────────────────────────────────
async function migrateBankPolicies(db: any) {
  const rows = readTable(db, "bank_policies");
  log(`  bank_policies: ${rows.length} rows...`);
  let inserted = 0, errors = 0;
  for (const batch of chunk(rows, CHUNK)) {
    try {
      const res = await pg.bankPolicy.createMany({
        skipDuplicates: true,
        data: batch.map(r => ({
          id: r.id, bankId: r.bankId, companyCategory: r.companyCategory,
          minSalary: Number(r.minSalary ?? 0), maxSalary: Number(r.maxSalary ?? 99999999),
          minAge: Number(r.minAge ?? 21), maxAge: Number(r.maxAge ?? 60),
          foir: Number(r.foir ?? 0), minCibil: Number(r.minCibil ?? 650),
          roi: Number(r.roi ?? 10.5), processingFee: Number(r.processingFee ?? 1),
          minLoanAmount: Number(r.minLoanAmount ?? 50000), maxLoanAmount: Number(r.maxLoanAmount ?? 50000000),
          minTenure: Number(r.minTenure ?? 12), maxTenure: Number(r.maxTenure ?? 360),
          employmentType: r.employmentType || "SALARIED",
          requiredDocuments: r.requiredDocuments || "PAN, AADHAAR",
          notes: r.notes || null, version: Number(r.version ?? 1),
          isActive: parseBool(r.isActive, true),
          createdAt: parseDate(r.createdAt), updatedAt: parseDate(r.updatedAt),
        })),
      });
      inserted += res.count;
    } catch (e: any) { errors++; }
  }
  results.push({ table: "bank_policies", sqlite: rows.length, inserted, skipped: rows.length - inserted - errors, errors });
  log(`  ✔ bank_policies: ${inserted} inserted`);
}

// ─── Key-Value tables ─────────────────────────────────────────────────────────
async function migrateKV(db: any, sqliteTable: string, label: string, pgModel: any) {
  const rows = readTable(db, sqliteTable);
  log(`  ${label}: ${rows.length} rows...`);
  let inserted = 0;
  for (const r of rows) {
    try {
      await pgModel.upsert({
        where: { key: r.key },
        update: {},
        create: {
          id: r.id, key: r.key,
          value: parseJson(r.value) ?? (r.value || {}),
          updatedAt: parseDate(r.updatedAt),
        },
      });
      inserted++;
    } catch { /* skip */ }
  }
  results.push({ table: label, sqlite: rows.length, inserted, skipped: rows.length - inserted, errors: 0 });
  log(`  ✔ ${label}: ${inserted} inserted`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   NVIT Solution — SQLite → Supabase Migration (v2)  ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  log("Connecting to PostgreSQL...");
  try {
    await pg.$queryRaw`SELECT 1`;
    log("✅ PostgreSQL connected\n");
  } catch (e: any) {
    console.error("❌ Cannot connect:", e.message);
    process.exit(1);
  }

  const sqlite = await openSQLite();
  console.log("");

  const t0 = Date.now();
  log("Starting bulk migration...\n");

  await migrateUsers(sqlite);
  await migrateBanks(sqlite);
  await migrateCompanies(sqlite);
  await migrateCategories(sqlite);
  await migratePincodes(sqlite);
  await migrateLeads(sqlite);
  await migrateImportHistories(sqlite);
  await migrateAuditLogs(sqlite);
  await migrateBankPolicies(sqlite);
  await migrateKV(sqlite, "marketing_settings", "marketing_settings", pg.marketingSettings);
  await migrateKV(sqlite, "system_settings",    "system_settings",    pg.systemSettings);
  await migrateKV(sqlite, "website_cms",         "website_cms",        pg.websiteCMS);

  sqlite.close();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const totalSqlite  = results.reduce((a, r) => a + r.sqlite,   0);
  const totalInsert  = results.reduce((a, r) => a + r.inserted, 0);
  const totalErrors  = results.reduce((a, r) => a + r.errors,   0);

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                    MIGRATION SUMMARY                       ║");
  console.log("╠══════════════════════════════════╦═══════╦════════╦═══════╣");
  console.log("║ Table                            ║SQLite ║Inserted║ Errs  ║");
  console.log("╠══════════════════════════════════╬═══════╬════════╬═══════╣");
  for (const r of results) {
    const icon = r.errors > 0 ? "⚠" : "✓";
    console.log(`║ ${icon} ${r.table.slice(0,31).padEnd(31)} ║${String(r.sqlite).padStart(6)} ║${String(r.inserted).padStart(7)} ║${String(r.errors).padStart(6)} ║`);
  }
  console.log("╠══════════════════════════════════╬═══════╬════════╬═══════╣");
  console.log(`║  TOTAL                           ║${String(totalSqlite).padStart(6)} ║${String(totalInsert).padStart(7)} ║${String(totalErrors).padStart(6)} ║`);
  console.log("╚══════════════════════════════════╩═══════╩════════╩═══════╝");
  console.log(`\n  ⏱  Completed in ${elapsed}s`);

  if (totalErrors === 0) {
    console.log("  ✅ Migration successful! dev.db is preserved as backup.");
  } else {
    console.log(`  ⚠️  ${totalErrors} error(s) — safe to re-run, already-inserted rows will be skipped.`);
  }

  await pg.$disconnect();
}

main().catch(e => { console.error("❌ Fatal:", e.message); pg.$disconnect(); process.exit(1); });
