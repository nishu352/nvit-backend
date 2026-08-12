import { prisma } from "../../config/prisma.js";
import { normalizeCompanyName } from "../../utils/normalize.js";

export async function searchCompanies(query: string, limitNum: number = 25) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const { normalizedName } = normalizeCompanyName(cleanQuery);

  const matchedAliases = await prisma.companyAlias.findMany({
    where: { alias: { startsWith: normalizedName } },
    select: { companyId: true }
  });
  const aliasCompanyIds = matchedAliases.map(a => a.companyId);

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
          ...(normalizedName ? [{ normalizedName: { startsWith: normalizedName } }] : []),
          ...(aliasCompanyIds.length > 0 ? [{ id: { in: aliasCompanyIds } }] : []),
        ],
      },
      take: limitNum,
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

  return rawCompanies.map((c: any) => {
    const categoryMap = new Map<string, any>();
    (c.bankCategories || []).forEach((bc: any) => {
      if (bc.bank?.id) {
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
          remarks: bc.remarks || null,
          rawCompanyName: bc.rawCompanyName || c.name,
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
        remarks: null,
      };
    });

    return {
      companyId: c.id,
      companyName: c.name,
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

  const { normalizedName } = normalizeCompanyName(cleanQuery);
  
  const matchedAliases = await prisma.companyAlias.findMany({
    where: { alias: { startsWith: normalizedName } },
    select: { companyId: true }
  });
  const aliasCompanyIds = matchedAliases.map(a => a.companyId);

  const raw = await prisma.company.findMany({
    where: {
      OR: [
        { name: { startsWith: cleanQuery, mode: "insensitive" } },
        ...(normalizedName ? [{ normalizedName: { startsWith: normalizedName } }] : []),
        ...(aliasCompanyIds.length > 0 ? [{ id: { in: aliasCompanyIds } }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      city: true,
      state: true,
    },
    take: 10,
    orderBy: { name: "asc" },
  });

  return raw;
}
