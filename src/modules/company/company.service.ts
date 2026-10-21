import { prisma } from "../../config/prisma.js";
import { normalizeCompanyName } from "../../utils/normalize.js";
import { calculateCompanyRelevance, tokenize } from "../../utils/relevanceRanker.js";
import {
  companyAutocompleteCache,
  companySearchCache,
  partnerBanksCache,
  companyAliasesCache,
  searchSingleflight,
  autocompleteSingleflight,
} from "../../utils/lruCache.js";

export interface CompanySearchFilters {
  limit?: number;
  page?: number;
  pincode?: string;
  city?: string;
  state?: string;
  bankId?: string;
  category?: string;
  companyId?: string;
}

/**
 * Cached partner banks retrieval (in-memory LRU with TTL).
 * Eliminates redundant database round trips for static partner bank metadata.
 */
async function getCachedPartnerBanks() {
  const cached = partnerBanksCache.get("active_partner_banks");
  if (cached) return cached;

  const banks = await prisma.bank.findMany({
    where: { partnerStatus: "ACTIVE" },
    orderBy: { priority: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
      logoUrl: true,
      applyEnabled: true,
      applyUrl: true,
    },
  });

  partnerBanksCache.set("active_partner_banks", banks, 15 * 60 * 1000); // 15 mins
  return banks;
}

/**
 * Cached company aliases retrieval (in-memory LRU with TTL).
 * Eliminates redundant database round trips for static company alias metadata.
 */
async function getCachedCompanyAliases() {
  const cached = companyAliasesCache.get("all_aliases");
  if (cached) return cached;

  const aliases = await prisma.companyAlias.findMany({
    select: { companyId: true, alias: true },
  });

  companyAliasesCache.set("all_aliases", aliases, 15 * 60 * 1000); // 15 mins
  return aliases;
}

/**
 * High-performance lean candidate retrieval & relevance scoring pipeline.
 * Selects only scalar fields needed for ranking and pagination.
 * Completely omits relational joins (bankCategories/bank) during candidate selection,
 * eliminating 80%+ relational overfetching and query overhead.
 */
async function getRankedCompanyCandidates(
  query: string,
  extraWhere: any = {},
  candidatePoolLimit: number = 80,
  selectedCompanyId?: string
) {
  const cleanQuery = (query || "").trim();
  if (!cleanQuery) return [];

  const { normalizedName, baseName } = normalizeCompanyName(cleanQuery);
  const tokens = tokenize(cleanQuery);

  const candidateMap = new Map<string, any>();

  const leanSelect = {
    id: true,
    name: true,
    normalizedName: true,
    baseName: true,
    cin: true,
    pincode: true,
    city: true,
    state: true,
  };

  // ── Selected companyId (guaranteed inclusion) ─────────────────────────────
  if (selectedCompanyId) {
    const selectedCompany = await prisma.company.findUnique({
      where: { id: selectedCompanyId },
      select: leanSelect,
    });
    if (selectedCompany) {
      candidateMap.set(selectedCompany.id, selectedCompany);
    }
  }

  // ── TIER 0: Guaranteed Exact Match Point Lookups ───────────────────────────
  // Sub-millisecond B-Tree point lookups ensure exact matches are NEVER crowded out by high-cardinality prefixes
  const exactConditions: any[] = [];
  if (normalizedName) {
    exactConditions.push({ normalizedName: normalizedName });
  }
  if (baseName) {
    exactConditions.push({ baseName: baseName });
  }
  if (cleanQuery) {
    exactConditions.push({ name: { equals: cleanQuery, mode: "insensitive" } });
    exactConditions.push({ cin: { equals: cleanQuery, mode: "insensitive" } });
  }

  if (exactConditions.length > 0) {
    const exactMatches = await prisma.company.findMany({
      where: {
        status: "ACTIVE",
        ...extraWhere,
        OR: exactConditions,
      },
      take: 20,
      select: leanSelect,
    });

    for (const c of exactMatches) {
      if (!candidateMap.has(c.id)) {
        candidateMap.set(c.id, c);
      }
    }
  }

  // Check aliases if normalizedName is available (in-memory cached lookup, bounded to 20)
  let aliasCompanyIds: string[] = [];
  if (normalizedName) {
    const allAliases = await getCachedCompanyAliases();
    aliasCompanyIds = allAliases
      .filter((a) => a.alias.startsWith(normalizedName))
      .slice(0, 20)
      .map((a) => a.companyId);
  }

  // ── TIER 1: High-Speed Indexed Prefix Scan (uses existing B-Tree indexes) ────
  // Index scan on normalizedName and baseName runs in ~0.05-2.7ms on PostgreSQL
  const indexedPrefixConditions: any[] = [];
  if (normalizedName) {
    indexedPrefixConditions.push({ normalizedName: { startsWith: normalizedName } });
  }
  if (baseName && baseName !== normalizedName) {
    indexedPrefixConditions.push({ baseName: { startsWith: baseName } });
  }
  if (aliasCompanyIds.length > 0) {
    indexedPrefixConditions.push({ id: { in: aliasCompanyIds } });
  }

  if (indexedPrefixConditions.length > 0) {
    const fastPrefixMatches = await prisma.company.findMany({
      where: {
        status: "ACTIVE",
        ...extraWhere,
        OR: indexedPrefixConditions,
      },
      take: 40,
      select: leanSelect,
    });

    for (const c of fastPrefixMatches) {
      if (!candidateMap.has(c.id)) {
        candidateMap.set(c.id, c);
      }
    }
  }

  // Smarter High-Quality / Definitive Match Check
  const hasStrongMatch = Array.from(candidateMap.values()).some((c) => {
    const norm = c.normalizedName || "";
    const base = c.baseName || "";
    const nameLower = c.name.toLowerCase();

    // 1. Exact or base match
    if (
      (normalizedName && norm === normalizedName) ||
      (baseName && base === baseName) ||
      (cleanQuery.length >= 4 && nameLower === cleanQuery.toLowerCase())
    ) {
      return true;
    }

    // 2. Multi-token in-order prefix match (e.g. "tata consultancy" -> "TATA CONSULTANCY SERVICES LIMITED")
    if (
      tokens.length > 1 &&
      normalizedName &&
      normalizedName.length >= 6 &&
      norm.startsWith(normalizedName)
    ) {
      return true;
    }

    // 3. Name directly starts with clean query (e.g. "state bank" -> "State Bank of India")
    if (cleanQuery.length >= 5 && nameLower.startsWith(cleanQuery.toLowerCase())) {
      return true;
    }

    return false;
  });

  // Check if candidate pool already contains all query tokens
  const hasAllTokensMatch = tokens.length > 1 && Array.from(candidateMap.values()).some((c) => {
    const nameLower = c.name.toLowerCase();
    return tokens.every((t) => nameLower.includes(t));
  });

  // ── TIER 2: Multi-Token ALL-MATCH (only if no strong match AND no all-tokens match AND pool < 20) ───
  if (tokens.length > 1 && candidateMap.size < 20 && !hasStrongMatch && !hasAllTokensMatch) {
    const validTokens = tokens.filter((t) => t.length >= 2);
    if (validTokens.length > 0) {
      const allTokenMatches = await prisma.company.findMany({
        where: {
          status: "ACTIVE",
          ...extraWhere,
          AND: validTokens.map((t) => ({
            name: { contains: t, mode: "insensitive" },
          })),
        },
        take: 40,
        select: leanSelect,
      });

      for (const c of allTokenMatches) {
        candidateMap.set(c.id, c);
      }
    }
  }

  // Check again after Tier 2 if we have all-token matches
  const updatedHasAllTokens = tokens.length > 1 && Array.from(candidateMap.values()).some((c) => {
    const nameLower = c.name.toLowerCase();
    return tokens.every((t) => nameLower.includes(t));
  });

  // ── TIER 3: Broad Substring & CIN Fallback (only if pool < 10 AND no strong match AND no all-tokens match) ─────
  const remainingLimit = candidatePoolLimit - candidateMap.size;
  if (remainingLimit > 0 && candidateMap.size < 10 && !hasStrongMatch && !updatedHasAllTokens) {
    const prefixOrConditions: any[] = [
      { name: { startsWith: cleanQuery, mode: "insensitive" } },
      ...(normalizedName ? [{ normalizedName: { contains: normalizedName } }] : []),
      ...(baseName ? [{ baseName: { contains: baseName } }] : []),
      { name: { contains: cleanQuery, mode: "insensitive" } },
      { cin: { contains: cleanQuery, mode: "insensitive" } },
    ];

    const fallbackMatches = await prisma.company.findMany({
      where: {
        status: "ACTIVE",
        ...extraWhere,
        OR: prefixOrConditions,
      },
      take: remainingLimit,
      select: leanSelect,
    });

    for (const c of fallbackMatches) {
      if (!candidateMap.has(c.id)) {
        candidateMap.set(c.id, c);
      }
    }
  }

  // Score & Rank with Central Relevance Engine
  const scored = Array.from(candidateMap.values())
    .map((c) => {
      if (selectedCompanyId && c.id === selectedCompanyId) {
        return {
          ...c,
          relevanceScore: 100,
          matchType: "EXACT_MATCH" as const,
        };
      }
      const rel = calculateCompanyRelevance(
        c.name,
        cleanQuery,
        c.normalizedName,
        c.baseName,
        c.cin,
        c.city,
        c.state,
        c.pincode
      );
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

// ─── Main Public Search Endpoint (Two-Phase Retrieval + LRU Cache + Coalescing) ─

export async function searchCompanies(query: string, filters: CompanySearchFilters = {}) {
  const cleanQuery = (query || "").trim();
  if (!cleanQuery) return [];

  const limitNum = Math.min(Math.max(1, Number(filters.limit) || 20), 100);
  const pageNum = Math.max(1, Number(filters.page) || 1);
  const skip = (pageNum - 1) * limitNum;

  // Build deterministic cache key covering all parameters
  const cacheKey = [
    cleanQuery.toLowerCase(),
    filters.pincode ? filters.pincode.trim() : "",
    filters.city ? filters.city.trim().toLowerCase() : "",
    filters.state ? filters.state.trim().toLowerCase() : "",
    filters.bankId || "",
    filters.category ? filters.category.trim().toUpperCase() : "",
    filters.companyId || "",
    limitNum,
    pageNum,
  ].join("::");

  const cached = companySearchCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Use Singleflight coalescing to prevent thundering herd
  return searchSingleflight.do(cacheKey, async () => {
    const doubleCheck = companySearchCache.get(cacheKey);
    if (doubleCheck) return doubleCheck;

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

    const candidatePoolLimit = Math.min(150, Math.max(80, (skip + limitNum) * 3));

    // Phase 1: Retrieve lean candidates and active partner banks concurrently
    const [allBanks, rankedCompanies] = await Promise.all([
      getCachedPartnerBanks(),
      getRankedCompanyCandidates(cleanQuery, extraWhere, candidatePoolLimit, filters.companyId),
    ]);

    const paginated = rankedCompanies.slice(skip, skip + limitNum);
    if (paginated.length === 0) {
      companySearchCache.set(cacheKey, [], 15 * 1000);
      return [];
    }

    // Phase 2: Fetch bankCategories ONLY for the paginated companies
    const targetCompanyIds = paginated.map((c: any) => c.id);
    const bankCategories = await prisma.companyBankCategory.findMany({
      where: { companyId: { in: targetCompanyIds } },
      select: {
        id: true,
        companyId: true,
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
    });

    // Group bankCategories by companyId for O(1) correlation
    const bcByCompany = new Map<string, any[]>();
    for (const bc of bankCategories) {
      if (!bcByCompany.has(bc.companyId)) {
        bcByCompany.set(bc.companyId, []);
      }
      bcByCompany.get(bc.companyId)!.push(bc);
    }

    const results = paginated.map((c: any) => {
      const companyBCs = bcByCompany.get(c.id) || [];
      const categoryMap = new Map<string, any>();
      companyBCs.forEach((bc: any) => {
        if (bc.bank?.id) {
          const existing = categoryMap.get(bc.bank.id);
          if (!existing || (existing.category === "UNLISTED" && bc.category !== "UNLISTED")) {
            categoryMap.set(bc.bank.id, bc);
          }
        }
      });

      const banksList = allBanks.map((b: any) => {
        const bc = categoryMap.get(b.id);
        if (bc) {
          return {
            bankId: b.id,
            bankName: b.name,
            bankCode: b.code,
            bankType: b.type,
            logoUrl: b.logoUrl,
            applyEnabled: b.applyEnabled ?? false,
            applyUrl: b.applyUrl || null,
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
          applyEnabled: b.applyEnabled ?? false,
          applyUrl: b.applyUrl || null,
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

    const ttl = results.length > 0 ? 3 * 60 * 1000 : 15 * 1000;
    companySearchCache.set(cacheKey, results, ttl);
    return results;
  });
}

// ─── Company Autocomplete / Suggestions (Lean Query + In-Memory LRU Cache) ───

export async function getCompanyAutocomplete(query: string) {
  const cleanQuery = (query || "").trim();
  if (!cleanQuery) return [];

  const cacheKey = cleanQuery.toLowerCase();
  const cached = companyAutocompleteCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  return autocompleteSingleflight.do(cacheKey, async () => {
    const doubleCheck = companyAutocompleteCache.get(cacheKey);
    if (doubleCheck) return doubleCheck;

    // Use the dedicated lean candidate retrieval pipeline (no bankCategories)
    const ranked = await getRankedCompanyCandidates(cleanQuery, {}, 60);

    const results = ranked.slice(0, 10).map((c) => ({
      id: c.id,
      name: c.name,
      city: c.city,
      state: c.state,
      relevanceScore: c.relevanceScore,
      matchType: c.matchType,
    }));

    // Cache non-empty results for 5 minutes, empty for 15 seconds
    const ttl = results.length > 0 ? 5 * 60 * 1000 : 15 * 1000;
    companyAutocompleteCache.set(cacheKey, results, ttl);

    return results;
  });
}

// ─── Single Company Detail by ID ──────────────────────────────────────────────

export async function getCompanyById(id: string) {
  if (!id) return null;

  const cacheKey = `company_id::${id}`;
  const cached = companySearchCache.get(cacheKey);
  if (cached) {
    return cached;
  }

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

  const result = {
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

  companySearchCache.set(cacheKey, result, 5 * 60 * 1000); // 5 mins
  return result;
}
