import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const companiesTotal = await prisma.company.count();
  const mappingsTotal = await prisma.companyBankCategory.count();
  const banks = await prisma.bank.findMany({ select: { id: true, name: true, code: true } });
  const pincodes = await prisma.pincodeServiceability.count();
  const loans = await prisma.loanApplication.count();
  const users = await prisma.user.count();
  const importHistory = await prisma.importHistory.findMany({
    include: { bank: { select: { name: true, code: true } } },
    orderBy: { createdAt: "desc" },
  });

  console.log("=== DATABASE STATUS ===");
  console.log("Companies:", companiesTotal);
  console.log("Bank-Company Mappings:", mappingsTotal);
  console.log("Pincodes:", pincodes);
  console.log("Loan Applications:", loans);
  console.log("Users:", users);
  console.log("\nBanks:", JSON.stringify(banks, null, 2));
  console.log(
    "\nImport History:",
    JSON.stringify(
      importHistory.map((h) => ({
        id: h.id,
        bank: h.bank.name,
        bankCode: h.bank.code,
        status: h.status,
        processed: h.processedRecords,
        total: h.totalRecords,
        createdAt: h.createdAt,
      })),
      null,
      2
    )
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
