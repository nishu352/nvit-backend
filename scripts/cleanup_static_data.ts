/**
 * CLEANUP SCRIPT — Delete ALL static/seed company data, pincodes, seed loan applications
 * KEEP: Banks (all), Users (admin), Import History (if any)
 * After this script — database will be clean, ready for real data upload via admin
 *
 * Run: npx tsx scripts/cleanup_static_data.ts
 */

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  console.log("🧹 Starting cleanup of ALL static/seed data...\n");

  // ── 1. Delete ALL CompanyBankCategory mappings ────────────────────────────
  const deletedMappings = await prisma.companyBankCategory.deleteMany({});
  console.log(`✅ Deleted ${deletedMappings.count} company-bank category mappings`);

  // ── 2. Delete ALL Company records ────────────────────────────────────────
  const deletedCompanies = await prisma.company.deleteMany({});
  console.log(`✅ Deleted ${deletedCompanies.count} company records`);

  // ── 3. Delete ALL Pincode serviceability data ────────────────────────────
  const deletedPincodes = await prisma.pincodeServiceability.deleteMany({});
  console.log(`✅ Deleted ${deletedPincodes.count} pincode records`);

  // ── 4. Delete ALL Loan Applications (test/seed data) ─────────────────────
  const deletedLoans = await prisma.loanApplication.deleteMany({});
  console.log(`✅ Deleted ${deletedLoans.count} loan application records`);

  // ── 5. Delete ALL Import History ──────────────────────────────────────────
  const deletedImportHistory = await prisma.importHistory.deleteMany({});
  console.log(`✅ Deleted ${deletedImportHistory.count} import history records`);

  // ── 6. Delete ALL Audit Logs (seed/test logs) ────────────────────────────
  const deletedAuditLogs = await prisma.auditLog.deleteMany({});
  console.log(`✅ Deleted ${deletedAuditLogs.count} audit log records`);

  // ── KEEP: Banks, Users, BankPolicies, LoanProducts ────────────────────────
  // Banks are kept because they are needed for the import form dropdown
  // Users (admin) are kept for login
  // Bank policies and products are kept if any were configured

  console.log("\n─────────────────────────────────────────");
  console.log("🔒 KEPT (not deleted):");

  const usersKept = await prisma.user.count();
  const banksKept = await prisma.bank.count();
  const policiesKept = await prisma.bankPolicy.count();
  const productsKept = await prisma.loanProduct.count();

  console.log(`   Users:         ${usersKept}`);
  console.log(`   Banks:         ${banksKept}`);
  console.log(`   Bank Policies: ${policiesKept}`);
  console.log(`   Loan Products: ${productsKept}`);

  console.log("\n─────────────────────────────────────────");
  console.log("📊 Database is now CLEAN and ready for real data upload.");
  console.log("   Next step: Upload ICICI.xlsx via Admin → Import page.");
  console.log("─────────────────────────────────────────\n");
}

main()
  .catch((err) => {
    console.error("❌ Cleanup failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
