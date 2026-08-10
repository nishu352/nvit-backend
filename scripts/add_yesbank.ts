import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const bank = await prisma.bank.upsert({
    where: { code: "YESBANK" },
    update: {
      name: "Yes Bank",
      type: "BANK",
      isActive: true,
      partnerStatus: "ACTIVE",
      priority: 8,
      displayOrder: 8,
      eligibility: "Salary > 20000, Age 21-60",
      processingFee: 1.25,
    },
    create: {
      name: "Yes Bank",
      code: "YESBANK",
      type: "BANK",
      isActive: true,
      partnerStatus: "ACTIVE",
      priority: 8,
      displayOrder: 8,
      eligibility: "Salary > 20000, Age 21-60",
      processingFee: 1.25,
    },
  });
  console.log("✅ Yes Bank upserted:", bank.id, "-", bank.name);
}

main().catch(console.error).finally(() => prisma.$disconnect());
