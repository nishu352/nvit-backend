import { prisma } from "../../config/prisma.js";
import { normalizeCompanyName } from "../../utils/normalize.js";
import { calculateCompanyRelevance, tokenize } from "../../utils/relevanceRanker.js";

export interface CompanySearchFilters {
  limit?: number;
  page?: number;
  pincode?: string;
  city?: string;
  state?: string;
  bankId?: string;
  category?: string;
}

/**
 * Common candidate retrieval & relevance scoring pipeline.
 * Used identically by both /company/search and /company/autocomplete.
 */
async function getRankedCompanyCandidates(
  query: string,
  extraWhere: any = {},
  candidatePoolLimit: number = 100
) {
  const cleanQuery = (query || "").trim();
  if (!cleanQuery) return [];

  const { normalizedName, baseName } = normalizeCompanyName(cleanQuery);
  const tokens = tokenize(cleanQuery);

  // Check aliases if normalizedName is available
  let aliasCompanyIds: string[] = [];
  if (normalizedName) {
    const matchedAliases = await prisma.companyAlias.findMany({
      where: { alias: { startsWith: normalizedName } },
      select: { companyId: true },
      take: 30,
    });
    aliasCompanyIds = matchedAliases.map((a) => a.companyId);
  }

  const candidateMap = new Map<string, any>();

  // ── PHASE 1: Multi-Token ALL-MATCH (Highest Priority Candidate Pool) ─────────
  // When user types multiple words like "tata capital" or "mahindra finance",
  // explicitly fetch companies matching ALL tokens first.
  if (tokens.length > 1) {
    const allTokensCondition: any = {
      status: "ACTIVE",
      ...extraWhere,
      AND: tokens.filter((t) => t.length >= 2).map((t) => ({
        name: { contains: t, mode: "insensitive" },
      })),
    };

    const allTokenMatches = await prisma.company.findMany({
      where: allTokensCondition,
      take: 60,
      select: {
        id: true,
        name: true,
        normalizedName: true,
        baseName: true,
        cin: true,
        pincode: true,
        city: true,
        state: true,
        bankCategories: {
          select: {
            id: true,
            category: true,
            status: true,
            remarks: true,
            rawCompanyName: true,
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

    for (const c of allTokenMatches) {
      candidateMap.set(c.id, c);
    }
  }

  // ── PHASE 2: Prefix & Broad Contains Matches ──────────────────────────────────
  const prefixOrConditions: any[] = [
    // Direct exact / phrase prefix
    { name: { startsWith: cleanQuery, mode: "insensitive" } },
    ...(normalizedName ? [{ normalizedName: { startsWith: normalizedName } }] : []),
    ...(baseName ? [{ baseName: { startsWith: baseName } }] : []),
    // Substring contains
    { name: { contains: cleanQuery, mode: "insensitive" } },
    ...(aliasCompanyIds.length > 0 ? [{ id: { in: aliasCompanyIds } }] : []),
  ];

  // For multi-token query, if pool is small, also look up companies starting with primary token
  if (tokens.length > 1 && candidateMap.size < 20 && tokens[0] && tokens[0].length >= 3) {
    prefixOrConditions.push({ name: { startsWith: tokens[0], mode: "insensitive" } });
  }

  const prefixMatches = await prisma.company.findMany({
    where: {
      status: "ACTIVE",
      ...extraWhere,
      OR: prefixOrConditions,
    },
    take: candidatePoolLimit,
    select: {
      id: true,
      name: true,
      normalizedName: true,
      baseName: true,
      cin: true,
      pincode: true,
      city: true,
      state: true,
      bankCategories: {
        select: {
          id: true,
          category: true,
          status: true,
          remarks: true,
          rawCompanyName: true,
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

  for (const c of prefixMatches) {
    if (!candidateMap.has(c.id)) {
      candidateMap.set(c.id, c);
    }
  }

  // ── Deduplicate by baseName / normalizedName ─────────────────────────────────
  const dedupedMap = new Map<string, any>();
  for (const c of candidateMap.values()) {
    const key = c.baseName || c.normalizedName || c.id;
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, { ...c, bankCategories: [...c.bankCategories] });
    } else {
      const existing = dedupedMap.get(key);
      existing.bankCategories.push(...c.bankCategories);
    }
  }

  // ── Score & Rank with Central Relevance Engine ────────────────────────────────
  const scored = Array.from(dedupedMap.values())
    .map((c) => {
      const rel = calculateCompanyRelevance(c.name, cleanQuery, c.normalizedName, c.baseName);
      return {
        ...c,
        relevanceScore: rel.score,
        matchType: rel.matchType,
      };
    })
    .filter((c) => c.relevanceScore > 0);

  // Deterministic sorting:
  // 1. Highest Relevance Score
  // 2. Shorter / cleaner name (closer exactness)
  // 3. Alphabetical tie-breaker
  scored.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    if (a.name.length !== b.name.length) {
      return a.name.length - b.name.length;
    }
    return a.name.localeCompare(b.name);
  });

  return scored;
}

// ─── Main Public Search Endpoint ──────────────────────────────────────────────

export async function searchCompanies(query: string, filters: CompanySearchFilters = {}) {
  const cleanQuery = (query || "").trim();
  if (!cleanQuery) return [];

  const limitNum = Math.min(Math.max(1, Number(filters.limit) || 20), 100);
  const pageNum = Math.max(1, Number(filters.page) || 1);
  const skip = (pageNum - 1) * limitNum;

  // Build optional attribute filters
  const extraWhere: any = {};
  if (filters.pincode) {
    extraWhere.pincode = filters.pincode.trim();
  }
  if (filters.city) {
    extraWhere.city = { contains: filters.city.trim(), mode: "insensitive" };
  }
  if (filters.state) {
    extraWhere.state = { contains: filters.state.trim(), mode: "insensitive" };
  }
  if (filters.bankId || filters.category) {
    extraWhere.bankCategories = {
      some: {
        ...(filters.bankId ? { bankId: filters.bankId } : {}),
        ...(filters.category ? { category: filters.category.toUpperCase().trim() } : {}),
      },
    };
  }

  const candidatePoolLimit = Math.min(200, Math.max(100, (skip + limitNum) * 3));

  // Run banks fetch and candidates ranking concurrently
  const [allBanks, rankedCompanies] = await Promise.all([
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
    getRankedCompanyCandidates(cleanQuery, extraWhere, candidatePoolLimit),
  ]);

  const paginated = rankedCompanies.slice(skip, skip + limitNum);

  return paginated.map((c: any) => {
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
      relevanceScore: c.relevanceScore,
      matchType: c.matchType,
      cin: c.cin,
      pincode: c.pincode,
      city: c.city,
      state: c.state,
      banks: banksList,
    };
  });
}

// ─── Company Autocomplete / Suggestions ───────────────────────────────────────

export async function getCompanyAutocomplete(query: string) {
  const cleanQuery = (query || "").trim();
  if (!cleanQuery) return [];

  // Use the exact same candidate retrieval & relevance scoring pipeline
  const ranked = await getRankedCompanyCandidates(cleanQuery, {}, 80);

  return ranked.slice(0, 10).map((c) => ({
    id: c.id,
    name: c.name,
    city: c.city,
    state: c.state,
    relevanceScore: c.relevanceScore,
    matchType: c.matchType,
  }));
}

// ─── Single Company Detail by ID ──────────────────────────────────────────────

export async function getCompanyById(id: string) {
  const company = await prisma.company.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      cin: true,
      pincode: true,
      city: true,
      state: true,
      district: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      bankCategories: {
        select: {
          id: true,
          category: true,
          status: true,
          source: true,
          remarks: true,
          updatedAt: true,
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
