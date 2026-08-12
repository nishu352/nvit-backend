const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  await prisma.importError.deleteMany();
  await prisma.importHistory.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
  
  const hashedPassword = await bcrypt.hash('@#$512Aui', 10);
  const admin = await prisma.user.create({
    data: {
      email: 'admin@nvit.space',
      password: hashedPassword,
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      isActive: true,
    }
  });
  console.log('Admin user created successfully:', admin.email);
}

main().catch(console.error).finally(() => prisma.$disconnect());
