import { PrismaClient } from "@prisma/client";
import { normalizeCompanyName } from "../src/utils/normalize.js";

const prisma = new PrismaClient();

async function run() {
  console.log("Starting Company Data Migration & Deduplication...");

  // 1. Fetch all companies
  const companies = await prisma.company.findMany({
    include: { bankCategories: true }
  });
  console.log(`Found ${companies.length} companies to process.`);

  // 2. Group by normalizedName and baseName
  // We'll update their normalizedName and baseName in the DB directly first.
  let updatedCount = 0;
  for (const c of companies) {
    const { normalizedName, baseName } = normalizeCompanyName(c.name);
    if (c.normalizedName !== normalizedName || c.baseName !== baseName) {
      // Temporarily bypass unique constraint issues by appending a UUID if needed,
      // but we'll just try to update. If it fails, it means there's a duplicate.
      // We will handle the actual merge in JS first to avoid DB constraint errors.
    }
  }

  // Instead of updating DB directly which hits unique constraints, let's group in JS.
  const baseNameGroups = new Map<string, typeof companies>();
  for (const c of companies) {
    const { normalizedName, baseName } = normalizeCompanyName(c.name);
    // attach to JS object
    (c as any).newNorm = normalizedName;
    (c as any).newBase = baseName;

    const group = baseNameGroups.get(baseName) || [];
    group.push(c);
    baseNameGroups.set(baseName, group);
  }

  let mergedCount = 0;
  let deletedCount = 0;

  for (const [baseName, group] of baseNameGroups.entries()) {
    if (group.length === 1) {
      // Just update the single record's normalizedName and baseName
      const c = group[0];
      await updateCompanySafely(c.id, (c as any).newNorm, (c as any).newBase);
      continue;
    }

    // We have >1 companies with the same baseName.
    // Let's resolve according to hierarchy.
    // Group by exact normalizedName first
    const normGroups = new Map<string, typeof companies>();
    for (const c of group) {
      const norm = (c as any).newNorm;
      const arr = normGroups.get(norm) || [];
      arr.push(c);
      normGroups.set(norm, arr);
    }

    // Merge exact matches (Level 1)
    for (const [norm, subGroup] of normGroups.entries()) {
      if (subGroup.length > 1) {
        // Sort by oldest first
        subGroup.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const canonical = subGroup[0];
        const duplicates = subGroup.slice(1);

        await mergeDuplicates(canonical, duplicates);
        mergedCount += duplicates.length;
        deletedCount += duplicates.length;
        
        // Remove duplicates from the main group so they aren't processed in Level 2
        for (const d of duplicates) {
          const idx = group.findIndex(g => g.id === d.id);
          if (idx > -1) group.splice(idx, 1);
        }
      }
    }

    // Level 2: Missing Suffix Match
    // Refresh group after exact merges
    const remaining = group;
    if (remaining.length > 1) {
      const noSuffix = remaining.filter(c => (c as any).newNorm === (c as any).newBase);
      const hasSuffix = remaining.filter(c => (c as any).newNorm !== (c as any).newBase);

      if (noSuffix.length === 1 && hasSuffix.length === 1) {
        // Safe to merge!
        const canonical = hasSuffix[0]; // Prefer the one with suffix as canonical
        const duplicate = noSuffix[0];
        
        await mergeDuplicates(canonical, [duplicate]);
        mergedCount++;
        deletedCount++;
      } else {
        console.log(`[Level 2] Ambiguous or conflicting suffixes for baseName: ${baseName}. Not merging.`);
      }
    }
    
    // Finally, ensure all remaining companies have their normalizedName/baseName updated
    for (const c of group) {
      // We check if it still exists (not deleted)
      const exists = await prisma.company.findUnique({ where: { id: c.id } });
      if (exists) {
        await updateCompanySafely(c.id, (c as any).newNorm, (c as any).newBase);
      }
    }
  }

  // Update rawCompanyName for all mappings that don't have it
  await prisma.$executeRaw`UPDATE company_bank_categories SET "rawCompanyName" = companies.name FROM companies WHERE company_bank_categories."companyId" = companies.id AND "rawCompanyName" IS NULL`;

  console.log(`Migration Complete. Merged ${mergedCount} duplicates. Deleted ${deletedCount} companies.`);
}

async function updateCompanySafely(id: string, norm: string, base: string) {
  try {
    await prisma.company.update({
      where: { id },
      data: { normalizedName: norm, baseName: base }
    });
  } catch (err: any) {
    if (err.code === 'P2002') {
      console.log(`[Warning] Could not update company ${id} to norm ${norm} due to unique constraint. Will append UUID.`);
      await prisma.company.update({
        where: { id },
        data: { normalizedName: norm + "_" + id.substring(0, 5), baseName: base }
      });
    }
  }
}

async function mergeDuplicates(canonical: any, duplicates: any[]) {
  console.log(`Merging into canonical: ${canonical.name} (${canonical.id})`);
  
  for (const dup of duplicates) {
    console.log(`  <- Consuming duplicate: ${dup.name} (${dup.id})`);
    
    // Move BankCategories
    for (const bc of dup.bankCategories) {
      try {
        await prisma.companyBankCategory.update({
          where: { id: bc.id },
          data: { 
            companyId: canonical.id,
            rawCompanyName: bc.rawCompanyName || dup.name 
          }
        });
      } catch (err: any) {
        // Might fail if the canonical company already has this bankId mapped (Unique constraint)
        if (err.code === 'P2002') {
          console.log(`  [Skip] Bank ${bc.bankId} already mapped for canonical company. Deleting duplicate mapping.`);
          await prisma.companyBankCategory.delete({ where: { id: bc.id } });
        }
      }
    }

    // Add Alias
    try {
      await prisma.companyAlias.create({
        data: {
          companyId: canonical.id,
          alias: (dup as any).newNorm
        }
      });
    } catch (e) {
      // Ignore if alias exists
    }

    // Delete duplicate company
    await prisma.company.delete({ where: { id: dup.id } });
  }
}

run().catch(console.error).finally(() => prisma.$disconnect());
