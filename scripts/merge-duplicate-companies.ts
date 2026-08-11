import { prisma } from "../src/config/prisma.js";
import { normalizeCompanyName } from "../src/utils/normalize.js";

interface CompanyRecord {
  id: string;
  name: string;
  normalizedName: string | null;
  cin: string | null;
}

async function mergeDuplicateCompanies() {
  console.log("🔍 Fetching all company records from database...");

  const allCompanies: CompanyRecord[] = await prisma.company.findMany({
    select: {
      id: true,
      name: true,
      normalizedName: true,
      cin: true,
    },
  });

  console.log(`Total companies indexed in DB: ${allCompanies.length}`);

  // Group by new canonical normalizedName
  const grouped = new Map<string, CompanyRecord[]>();

  for (const comp of allCompanies) {
    const newNorm = normalizeCompanyName(comp.name);
    if (!newNorm) continue;

    if (!grouped.has(newNorm)) {
      grouped.set(newNorm, [comp]);
    } else {
      grouped.get(newNorm)!.push(comp);
    }
  }

  let mergedGroupCount = 0;
  let deletedDuplicateCount = 0;
  let remappedCategoryCount = 0;

  for (const [newNorm, group] of grouped.entries()) {
    if (group.length <= 1) {
      // Just update normalizedName if it changed
      const primary = group[0];
      if (primary.normalizedName !== newNorm) {
        await prisma.company.update({
          where: { id: primary.id },
          data: { normalizedName: newNorm },
        }).catch(() => {});
      }
      continue;
    }

    mergedGroupCount++;
    console.log(`\nFound Duplicate Group #${mergedGroupCount} for normalized name "${newNorm}":`);
    group.forEach((g: CompanyRecord) => console.log(` - ID: ${g.id} | Name: "${g.name}"`));

    // Choose primary (prefer one with CIN or first in array)
    const primary = group.find((g: CompanyRecord) => !!g.cin) || group[0];
    const secondaries = group.filter((g: CompanyRecord) => g.id !== primary.id);

    for (const sec of secondaries) {
      // Get all categories of secondary
      const secCategories = await prisma.companyBankCategory.findMany({
        where: { companyId: sec.id },
      });

      for (const cat of secCategories) {
        // Upsert into primary company
        await prisma.companyBankCategory.upsert({
          where: {
            companyId_bankId: {
              companyId: primary.id,
              bankId: cat.bankId,
            },
          },
          update: {
            category: cat.category,
            status: cat.status,
            remarks: cat.remarks,
          },
          create: {
            companyId: primary.id,
            bankId: cat.bankId,
            category: cat.category,
            status: cat.status,
            remarks: cat.remarks,
          },
        }).catch(() => {});
        remappedCategoryCount++;
      }

      // Delete secondary categories and company row
      await prisma.companyBankCategory.deleteMany({ where: { companyId: sec.id } });
      await prisma.company.delete({ where: { id: sec.id } }).catch(() => {});
      deletedDuplicateCount++;
    }

    // Update primary company normalizedName
    await prisma.company.update({
      where: { id: primary.id },
      data: { normalizedName: newNorm },
    }).catch(() => {});
  }

  console.log("\n==============================================");
  console.log(`✅ MERGE COMPLETE!`);
  console.log(`- Duplicate Groups Merged: ${mergedGroupCount}`);
  console.log(`- Duplicate Company Rows Deleted: ${deletedDuplicateCount}`);
  console.log(`- Bank Category Records Remapped: ${remappedCategoryCount}`);
  console.log("==============================================");
}

mergeDuplicateCompanies()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
