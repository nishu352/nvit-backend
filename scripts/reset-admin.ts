import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash("Admin@123", 10);

  // Reset password for all existing users
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true } });

  for (const u of users) {
    await prisma.user.update({
      where: { id: u.id },
      data: { password: hash, isActive: true },
    });
    console.log(`✔ Reset password for: ${u.email} (${u.role})`);
  }

  // Ensure an NVIT admin exists
  await prisma.user.upsert({
    where: { email: "admin@nvitsolution.com" },
    update: { password: hash, role: "SUPER_ADMIN", isActive: true, name: "NVIT Super Admin" },
    create: {
      email: "admin@nvitsolution.com",
      password: hash,
      name: "NVIT Super Admin",
      role: "SUPER_ADMIN",
      isActive: true,
    },
  });
  console.log("✔ Upserted: admin@nvitsolution.com (SUPER_ADMIN)");

  console.log("\n════════════════════════════════════════");
  console.log("  ✅ LOGIN CREDENTIALS (all reset to same password)");
  console.log("════════════════════════════════════════");
  const all = await prisma.user.findMany({ select: { email: true, role: true } });
  all.forEach(u => console.log(`  📧 ${u.email.padEnd(35)} 🔑 Admin@123   👤 ${u.role}`));
  console.log("════════════════════════════════════════\n");
}

main()
  .catch((e) => console.error("Error:", e.message))
  .finally(() => prisma.$disconnect());
