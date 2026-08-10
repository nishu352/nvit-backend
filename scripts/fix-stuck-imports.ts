import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const stuck = await p.importHistory.findMany({
    where: { status: "PROCESSING" },
    select: { id: true, fileName: true, totalRecords: true, createdAt: true }
  });

  console.log(`Found ${stuck.length} stuck import(s):`);
  stuck.forEach(s => console.log(`  - ${s.fileName} (${s.totalRecords} rows) started ${s.createdAt}`));

  if (stuck.length > 0) {
    await p.importHistory.updateMany({
      where: { status: "PROCESSING" },
      data: {
        status: "FAILED",
        errorMessage: "Import interrupted — server restarted during background processing. Please re-upload the file to try again."
      }
    });
    console.log(`\n✅ Marked ${stuck.length} import(s) as FAILED — admin panel will now unblock.`);
  } else {
    console.log("No stuck imports found.");
  }
}

main().catch(console.error).finally(() => p.$disconnect());
