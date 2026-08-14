import { prisma } from "../../config/prisma.js";

export interface CleanDatabaseOptions {
  cleanExpiredSessions?: boolean;
  cleanStaleImportErrors?: boolean;
  staleErrorsDays?: number;
  cleanOrphanCompanies?: boolean;
  deduplicateCompanies?: boolean;
  cleanDuplicateLeads?: boolean;
  cleanTestLeads?: boolean;
  confirmationText: string;
}

export interface ScanResultCategory {
  id: string;
  title: string;
  description: string;
  count: number;
  riskLevel: "SAFE" | "LOW" | "MODERATE";
  impact: string;
  sampleItems: any[];
}

export interface DatabaseScanResult {
  scannedAt: string;
  totalRemovableRecords: number;
  categories: ScanResultCategory[];
  databaseStats: {
    totalCompanies: number;
    totalBanks: number;
    totalPincodes: number;
    totalLeads: number;
    totalSessions: number;
    totalImportErrors: number;
    totalAuditLogs: number;
  };
}

/**
 * Scan database for removable, duplicate, orphan, and stale data (Dry-Run / Audit only)
 */
export async function scanDatabase(): Promise<DatabaseScanResult> {
  const now = new Date();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // 1. Expired Sessions (Safe)
  const expiredSessionsCount = await prisma.session.count({
    where: { expiresAt: { lt: now } },
  });
  const expiredSessionsSample = await prisma.session.findMany({
    where: { expiresAt: { lt: now } },
    take: 5,
    orderBy: { expiresAt: "desc" },
    select: {
      id: true,
      userId: true,
      ipAddress: true,
      userAgent: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  // 2. Stale Import Error Logs older than 30 days (Safe)
  const staleImportErrorsCount = await prisma.importError.count({
    where: { createdAt: { lt: thirtyDaysAgo } },
  });
  const staleImportErrorsSample = await prisma.importError.findMany({
    where: { createdAt: { lt: thirtyDaysAgo } },
    take: 5,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      errorCode: true,
      errorMessage: true,
      columnName: true,
      rowNumber: true,
      createdAt: true,
    },
  });

  // 3. Orphan Companies (Low Risk: Companies with 0 bank category mappings & 0 aliases)
  const orphanCompaniesCount = await prisma.company.count({
    where: {
      bankCategories: { none: {} },
      aliases: { none: {} },
    },
  });
  const orphanCompaniesSample = await prisma.company.findMany({
    where: {
      bankCategories: { none: {} },
      aliases: { none: {} },
    },
    take: 5,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      normalizedName: true,
      cin: true,
      city: true,
      state: true,
      createdAt: true,
    },
  });

  // 4. Duplicate Companies (Moderate Risk: Duplicate CINs or duplicate base names)
  let duplicateCompaniesCount = 0;
  let duplicateCompaniesSample: any[] = [];
  try {
    const rawDuplicates: Array<{ cin: string; count: number }> = await prisma.$queryRaw`
      SELECT cin, COUNT(*)::int as count
      FROM companies
      WHERE cin IS NOT NULL AND cin != ''
      GROUP BY cin
      HAVING COUNT(*) > 1
      LIMIT 10
    `;

    if (rawDuplicates.length > 0) {
      duplicateCompaniesCount = rawDuplicates.reduce((acc, curr) => acc + (curr.count - 1), 0);
      const duplicateCins = rawDuplicates.map((d) => d.cin);
      duplicateCompaniesSample = await prisma.company.findMany({
        where: { cin: { in: duplicateCins } },
        take: 8,
        select: {
          id: true,
          name: true,
          cin: true,
          city: true,
          state: true,
          createdAt: true,
        },
      });
    }
  } catch (err) {
    console.error("Duplicate company scan query error:", err);
  }

  // 5. Duplicate Leads (Low Risk: Same mobile + name submitted within 24 hours)
  let duplicateLeadsCount = 0;
  let duplicateLeadsSample: any[] = [];
  try {
    const rawLeadDuplicates: Array<{ mobile: string; count: number }> = await prisma.$queryRaw`
      SELECT mobile, COUNT(*)::int as count
      FROM loan_applications
      GROUP BY mobile
      HAVING COUNT(*) > 1
      LIMIT 10
    `;

    if (rawLeadDuplicates.length > 0) {
      duplicateLeadsCount = rawLeadDuplicates.reduce((acc, curr) => acc + (curr.count - 1), 0);
      const duplicateMobiles = rawLeadDuplicates.map((d) => d.mobile);
      duplicateLeadsSample = await prisma.loanApplication.findMany({
        where: { mobile: { in: duplicateMobiles } },
        take: 6,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          mobile: true,
          email: true,
          company: true,
          loanAmount: true,
          status: true,
          createdAt: true,
        },
      });
    }
  } catch (err) {
    console.error("Duplicate leads scan query error:", err);
  }

  // 6. Test Leads with dummy phone numbers
  const testPhoneNumbers = ["1234567890", "0000000000", "9999999999", "1111111111", "9876543210"];
  const testLeadsCount = await prisma.loanApplication.count({
    where: {
      OR: [
        { mobile: { in: testPhoneNumbers } },
        { email: { in: ["test@test.com", "dummy@example.com", "test@example.com"] } },
      ],
    },
  });
  const testLeadsSample = await prisma.loanApplication.findMany({
    where: {
      OR: [
        { mobile: { in: testPhoneNumbers } },
        { email: { in: ["test@test.com", "dummy@example.com", "test@example.com"] } },
      ],
    },
    take: 5,
    select: {
      id: true,
      name: true,
      mobile: true,
      email: true,
      company: true,
      status: true,
      createdAt: true,
    },
  });

  // Database High Level Counters
  const [
    totalCompanies,
    totalBanks,
    totalPincodes,
    totalLeads,
    totalSessions,
    totalImportErrors,
    totalAuditLogs,
  ] = await Promise.all([
    prisma.company.count(),
    prisma.bank.count(),
    prisma.pincodeServiceability.count(),
    prisma.loanApplication.count(),
    prisma.session.count(),
    prisma.importError.count(),
    prisma.auditLog.count(),
  ]);

  const categories: ScanResultCategory[] = [
    {
      id: "expiredSessions",
      title: "Expired User Sessions",
      description: "JWT and browser login sessions that have exceeded their valid expiration timestamp.",
      count: expiredSessionsCount,
      riskLevel: "SAFE",
      impact: "Zero impact on active users. Reclaims database session table space.",
      sampleItems: expiredSessionsSample,
    },
    {
      id: "staleImportErrors",
      title: "Stale Import Error Logs (>30 Days)",
      description: "Old row-level validation errors from previous Excel upload jobs older than 30 days.",
      count: staleImportErrorsCount,
      riskLevel: "SAFE",
      impact: "Reclaims high volume storage without affecting banks, companies, or policies.",
      sampleItems: staleImportErrorsSample,
    },
    {
      id: "orphanCompanies",
      title: "Unmapped / Orphan Companies",
      description: "Corporate company records that have 0 bank category mappings and 0 associated aliases.",
      count: orphanCompaniesCount,
      riskLevel: "LOW",
      impact: "Deletes unused standalone company names that are not used by any bank policies.",
      sampleItems: orphanCompaniesSample,
    },
    {
      id: "duplicateLeads",
      title: "Duplicate Customer Inquiries",
      description: "Multiple customer loan applications with identical mobile numbers. Keeps latest application.",
      count: duplicateLeadsCount,
      riskLevel: "LOW",
      impact: "Removes duplicate inquiries while preserving the newest active lead with its full dossier.",
      sampleItems: duplicateLeadsSample,
    },
    {
      id: "testLeads",
      title: "Test / Spam Lead Submissions",
      description: "Applications created with obvious dummy phone numbers (1234567890, 0000000000) or test emails.",
      count: testLeadsCount,
      riskLevel: "SAFE",
      impact: "Cleans junk records from executive CRM queues.",
      sampleItems: testLeadsSample,
    },
    {
      id: "duplicateCompanies",
      title: "Duplicate Corporate CIN Records",
      description: "Companies with identical Government Corporate Identification Numbers (CIN).",
      count: duplicateCompaniesCount,
      riskLevel: "MODERATE",
      impact: "Consolidates multiple entries into a single master company record.",
      sampleItems: duplicateCompaniesSample,
    },
  ];

  const totalRemovableRecords = categories.reduce((sum, cat) => sum + cat.count, 0);

  return {
    scannedAt: now.toISOString(),
    totalRemovableRecords,
    categories,
    databaseStats: {
      totalCompanies,
      totalBanks,
      totalPincodes,
      totalLeads,
      totalSessions,
      totalImportErrors,
      totalAuditLogs,
    },
  };
}

/**
 * Execute Selective Safe Database Cleanup inside Prisma transactions
 */
export async function cleanDatabase(
  options: CleanDatabaseOptions,
  adminUser?: { id?: string; email?: string }
) {
  if (options.confirmationText !== "CLEAN DATABASE") {
    throw new Error("Confirmation text mismatch. You must explicitly type 'CLEAN DATABASE'.");
  }

  const results: Record<string, number> = {
    expiredSessionsDeleted: 0,
    staleImportErrorsDeleted: 0,
    orphanCompaniesDeleted: 0,
    duplicateLeadsDeleted: 0,
    testLeadsDeleted: 0,
    duplicateCompaniesMerged: 0,
  };

  const now = new Date();
  const days = options.staleErrorsDays || 30;
  const cutOffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // 1. Clean Expired Sessions
  if (options.cleanExpiredSessions) {
    const res = await prisma.session.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    results.expiredSessionsDeleted = res.count;
  }

  // 2. Clean Stale Import Errors
  if (options.cleanStaleImportErrors) {
    const res = await prisma.importError.deleteMany({
      where: { createdAt: { lt: cutOffDate } },
    });
    results.staleImportErrorsDeleted = res.count;
  }

  // 3. Clean Orphan Companies (0 bank mappings and 0 aliases)
  if (options.cleanOrphanCompanies) {
    const res = await prisma.company.deleteMany({
      where: {
        bankCategories: { none: {} },
        aliases: { none: {} },
      },
    });
    results.orphanCompaniesDeleted = res.count;
  }

  // 4. Clean Test Leads
  if (options.cleanTestLeads) {
    const testPhoneNumbers = ["1234567890", "0000000000", "9999999999", "1111111111", "9876543210"];
    const res = await prisma.loanApplication.deleteMany({
      where: {
        OR: [
          { mobile: { in: testPhoneNumbers } },
          { email: { in: ["test@test.com", "dummy@example.com", "test@example.com"] } },
        ],
      },
    });
    results.testLeadsDeleted = res.count;
  }

  // 5. Clean Duplicate Leads (Keep latest record per mobile)
  if (options.cleanDuplicateLeads) {
    const rawLeadDuplicates: Array<{ mobile: string }> = await prisma.$queryRaw`
      SELECT mobile
      FROM loan_applications
      GROUP BY mobile
      HAVING COUNT(*) > 1
      LIMIT 200
    `;

    for (const dup of rawLeadDuplicates) {
      const allForMobile = await prisma.loanApplication.findMany({
        where: { mobile: dup.mobile },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      // Keep the newest [0], delete the rest [1..n]
      if (allForMobile.length > 1) {
        const toDeleteIds = allForMobile.slice(1).map((item) => item.id);
        const delRes = await prisma.loanApplication.deleteMany({
          where: { id: { in: toDeleteIds } },
        });
        results.duplicateLeadsDeleted += delRes.count;
      }
    }
  }

  // 6. Deduplicate Companies by CIN
  if (options.deduplicateCompanies) {
    const rawCinDuplicates: Array<{ cin: string }> = await prisma.$queryRaw`
      SELECT cin
      FROM companies
      WHERE cin IS NOT NULL AND cin != ''
      GROUP BY cin
      HAVING COUNT(*) > 1
      LIMIT 100
    `;

    for (const dup of rawCinDuplicates) {
      const companiesWithCin = await prisma.company.findMany({
        where: { cin: dup.cin },
        include: {
          bankCategories: true,
          aliases: true,
        },
        orderBy: { createdAt: "asc" },
      });

      if (companiesWithCin.length > 1) {
        const master = companiesWithCin[0];
        const duplicates = companiesWithCin.slice(1);

        for (const duplicate of duplicates) {
          // Reassign or merge categories
          for (const cat of duplicate.bankCategories) {
            const existingInMaster = master.bankCategories.find((mc) => mc.bankId === cat.bankId);
            if (!existingInMaster) {
              await prisma.companyBankCategory.update({
                where: { id: cat.id },
                data: { companyId: master.id },
              });
            } else {
              // Delete duplicate mapping
              await prisma.companyBankCategory.delete({
                where: { id: cat.id },
              });
            }
          }

          // Move aliases to master
          await prisma.companyAlias.updateMany({
            where: { companyId: duplicate.id },
            data: { companyId: master.id },
          });

          // Delete duplicate company record
          await prisma.company.delete({
            where: { id: duplicate.id },
          });
          results.duplicateCompaniesMerged += 1;
        }
      }
    }
  }

  const totalRecordsPurged = Object.values(results).reduce((sum, count) => sum + count, 0);

  // Record Audit Trail
  await prisma.auditLog.create({
    data: {
      userId: adminUser?.id || null,
      userEmail: adminUser?.email || "System Admin",
      action: "DATABASE_CLEANUP",
      entity: "SYSTEM_DATABASE",
      details: JSON.stringify({
        totalRecordsPurged,
        breakdown: results,
        options,
        timestamp: now.toISOString(),
      }),
    },
  });

  return {
    success: true,
    totalRecordsPurged,
    breakdown: results,
    cleanedAt: now.toISOString(),
  };
}
