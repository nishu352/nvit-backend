import { prisma } from "../../config/prisma.js";
import { normalizeCompanyName } from "../../utils/normalize.js";

export async function searchCompanies(query: string, limitNum: number = 25) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const normalizedQuery = normalizeCompanyName(cleanQuery);

  const [allBanks, rawCompanies] = await Promise.all([
    prisma.bank.findMany({
      where: { partnerStatus: "ACTIVE" },
      orderBy: { priority: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        type: true,
        logoUrl: true,
      },
    }),
    prisma.company.findMany({
      where: {
        OR: [
          { name: { startsWith: cleanQuery, mode: "insensitive" } },
          ...(normalizedQuery ? [{ normalizedName: { startsWith: normalizedQuery } }] : []),
        ],
      },
      take: limitNum * 2, // Fetch extra candidate rows for in-memory deduplication & merging
      include: {
        bankCategories: {
          include: {
            bank: {
              select: {
                id: true,
                name: true,
                code: true,
                type: true,
                logoUrl: true,
              },
            },
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    }),
  ]);

  // Group duplicate companies by their canonical normalizedName
  const groupedMap = new Map<string, any>();

  for (const c of rawCompanies) {
    const normKey = normalizeCompanyName(c.name) || normalizeCompanyName(c.normalizedName);

    if (!groupedMap.has(normKey)) {
      groupedMap.set(normKey, {
        companyId: c.id,
        companyName: c.name,
        cin: c.cin,
        pincode: c.pincode,
        city: c.city,
        state: c.state,
        allCategories: [...(c.bankCategories || [])],
      });
    } else {
      // Merge bank categories into existing canonical group
      const existingGroup = groupedMap.get(normKey);
      if (c.cin && !existingGroup.cin) existingGroup.cin = c.cin;
      existingGroup.allCategories.push(...(c.bankCategories || []));
    }
  }

  const mergedCompanies = Array.from(groupedMap.values()).slice(0, limitNum);

  return mergedCompanies.map((c: any) => {
    // Build map of bankId -> category record
    const categoryMap = new Map<string, any>();
    (c.allCategories || []).forEach((bc: any) => {
      if (bc.bank?.id) {
        // If bank category isn't set or is UNLISTED, prefer an explicit listed category (CAT A, CAT B, etc.)
        const existing = categoryMap.get(bc.bank.id);
        if (!existing || (existing.category === "UNLISTED" && bc.category !== "UNLISTED")) {
          categoryMap.set(bc.bank.id, bc);
        }
      }
    });

    const banksList = allBanks.map((b) => {
      const bc = categoryMap.get(b.id);
      if (bc) {
        return {
          bankId: b.id,
          bankName: b.name,
          bankCode: b.code,
          bankType: b.type,
          logoUrl: b.logoUrl,
          category: bc.category || "UNLISTED",
          status: bc.status || "APPROVED",
          source: bc.source,
          remarks: bc.remarks || "Specific Bank Policy Index",
          updatedAt: bc.updatedAt,
        };
      }

      return {
        bankId: b.id,
        bankName: b.name,
        bankCode: b.code,
        bankType: b.type,
        logoUrl: b.logoUrl,
        category: "UNLISTED",
        status: "APPROVED",
        source: "SYSTEM_DEFAULT",
        remarks: "Unlisted Company (Standard Policy Applies)",
        updatedAt: null,
      };
    });

    return {
      companyId: c.companyId,
      companyName: c.companyName,
      cin: c.cin,
      pincode: c.pincode,
      city: c.city,
      state: c.state,
      banks: banksList,
    };
  });
}

export async function getCompanyById(id: string) {
  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      bankCategories: {
        include: {
          bank: {
            select: {
              id: true,
              name: true,
              code: true,
              type: true,
              logoUrl: true,
            },
          },
        },
      },
    },
  });

  if (!company) return null;

  return {
    companyId: company.id,
    companyName: company.name,
    cin: company.cin,
    pincode: company.pincode,
    city: company.city,
    state: company.state,
    district: company.district,
    status: company.status,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
    banks: company.bankCategories.map((bc: any) => ({
      bankId: bc.bank.id,
      bankName: bc.bank.name,
      bankCode: bc.bank.code,
      bankType: bc.bank.type,
      logoUrl: bc.bank.logoUrl,
      category: bc.category,
      status: bc.status,
      source: bc.source,
      remarks: bc.remarks || "Standard Policy Classification",
      updatedAt: bc.updatedAt,
    })),
  };
}

export async function getCompanyAutocomplete(query: string) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const normalizedQuery = normalizeCompanyName(cleanQuery);

  const raw = await prisma.company.findMany({
    where: {
      OR: [
        { name: { startsWith: cleanQuery, mode: "insensitive" } },
        ...(normalizedQuery ? [{ normalizedName: { startsWith: normalizedQuery } }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      city: true,
      state: true,
    },
    take: 20,
    orderBy: { name: "asc" },
  });

  // Deduplicate by normalized name
  const seenNorm = new Set<string>();
  const uniqueItems: typeof raw = [];

  for (const item of raw) {
    const norm = normalizeCompanyName(item.name);
    if (!seenNorm.has(norm)) {
      seenNorm.add(norm);
      uniqueItems.push(item);
    }
  }

  return uniqueItems.slice(0, 10);
}
