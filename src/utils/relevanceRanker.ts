import { normalizeCompanyName } from "./normalize.js";

export type MatchType =
  | "EXACT_MATCH"
  | "CIN_MATCH"
  | "EXACT_PREFIX"
  | "WORD_PREFIX"
  | "IN_ORDER_TOKENS_MATCH"
  | "ALL_TOKENS_MATCH"
  | "NORMALIZED_PREFIX"
  | "NORMALIZED_SUBSTRING"
  | "PARTIAL_TOKEN_MATCH"
  | "CONTAINS"
  | "LOCATION_MATCH"
  | "FUZZY_MATCH"
  | "NO_MATCH";

export interface RelevanceScoreResult {
  score: number; // 0 to 100
  matchType: MatchType;
  matchedTokens: number;
  totalTokens: number;
}

/**
 * Fast Levenshtein distance for fuzzy fallback on individual words
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity (0 to 1) between two strings
 */
function stringSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  if (longer.length === 0) return 1.0;
  const editDistance = levenshtein(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Clean & tokenize text into alphanumeric words
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Strip leading punctuation/quotes from company names (e.g. "*BLUE CRISTAL" -> "BLUE CRISTAL")
 */
function cleanLeadingPunctuation(str: string): string {
  return str.replace(/^[^a-zA-Z0-9]+/, "").trim();
}

/**
 * Calculate deterministic relevance score (0 - 100) of a company record against user search query.
 * 
 * Strict Prefix-First Hierarchy:
 *  100       = Exact full match (case/space-insensitive or normalized)
 *  95 - 99   = CIN Match
 *  92 - 98   = Exact prefix match (Company name starts with user query as typed)
 *  84 - 90   = Word prefix match (A specific word in company name starts with query)
 *  78 - 84   = In-order multi-token prefix match (e.g. "ind farm" -> "Indian Farmers...")
 *  70 - 77   = Unordered multi-token match (e.g. "fertiliser indian")
 *  60 - 69   = Normalized prefix match for continuous/spaceless queries (e.g. "indianfarmersfer")
 *  40 - 55   = Location match / Normalized middle substring (only if query >= 4 chars)
 *  25 - 35   = Middle substring inside a word (Only for long queries >= 5 chars, never for short prefixes)
 *  0         = Irrelevant / No match
 */
export function calculateCompanyRelevance(
  companyName: string,
  query: string,
  normalizedCompany?: string,
  baseCompany?: string,
  cin?: string | null,
  city?: string | null,
  state?: string | null,
  pincode?: string | null
): RelevanceScoreResult {
  const cleanQ = (query || "").trim().toLowerCase();
  const rawCleanName = (companyName || "").trim().toLowerCase();
  const cleanName = cleanLeadingPunctuation(rawCleanName);

  if (!cleanQ || (!cleanName && !cin && !city)) {
    return { score: 0, matchType: "NO_MATCH", matchedTokens: 0, totalTokens: 0 };
  }

  const { normalizedName: normQ, baseName: baseQ } = normalizeCompanyName(cleanQ);
  const normC = normalizedCompany || normalizeCompanyName(cleanName).normalizedName;
  const baseC = baseCompany || normalizeCompanyName(cleanName).baseName;

  const qTokens = tokenize(cleanQ);
  const nameTokens = tokenize(cleanName);
  const totalTokens = qTokens.length;

  // ── 0. CIN MATCH ───────────────────────────────────────────────────────────
  if (cin) {
    const cleanCin = cin.trim().toLowerCase();
    if (cleanCin === cleanQ) {
      return { score: 100, matchType: "CIN_MATCH", matchedTokens: totalTokens, totalTokens };
    }
    if (cleanCin.startsWith(cleanQ) && cleanQ.length >= 3) {
      return { score: 96, matchType: "CIN_MATCH", matchedTokens: totalTokens, totalTokens };
    }
    if (cleanCin.includes(cleanQ) && cleanQ.length >= 4) {
      return { score: 90, matchType: "CIN_MATCH", matchedTokens: totalTokens, totalTokens };
    }
  }

  // ── 1. EXACT MATCH (Score: 100) ───────────────────────────────────────────
  if (
    cleanName === cleanQ ||
    rawCleanName === cleanQ ||
    (normQ && normC && normQ === normC && normQ.length >= 2) ||
    (baseQ && baseC && baseQ === baseC && baseQ.length >= 2)
  ) {
    return { score: 100, matchType: "EXACT_MATCH", matchedTokens: totalTokens, totalTokens };
  }

  // ── 2. EXACT PREFIX MATCH (Score: 92 - 98) ───────────────────────────────
  // Company name starts directly with what the user typed (e.g. "ind" -> "Indian...", "tata" -> "Tata Motors")
  if (cleanName.startsWith(cleanQ) || rawCleanName.startsWith(cleanQ)) {
    const lengthPenalty = Math.min(6, Math.floor((cleanName.length - cleanQ.length) / 10));
    const score = Math.max(92, 98 - lengthPenalty);
    return { score, matchType: "EXACT_PREFIX", matchedTokens: totalTokens, totalTokens };
  }

  // Normalized prefix match (handles spaceless typing e.g. "indianfarmersfer" -> "INDIAN FARMERS FERTILISER...")
  if (
    (normQ && normC && normC.startsWith(normQ) && normQ.length >= 3) ||
    (baseQ && baseC && baseC.startsWith(baseQ) && baseQ.length >= 3)
  ) {
    const lengthPenalty = Math.min(6, Math.floor((normC.length - normQ.length) / 10));
    const score = Math.max(90, 96 - lengthPenalty);
    return { score, matchType: "NORMALIZED_PREFIX", matchedTokens: totalTokens, totalTokens };
  }

  // ── 3. WORD PREFIX MATCH (Single Token Query) ────────────────────────────
  // e.g. "cristal" -> "Blue Cristal", "motors" -> "Tata Motors"
  if (totalTokens === 1) {
    const singleToken = qTokens[0];

    // Check if any word in company name STARTS with what user is typing
    for (let i = 0; i < nameTokens.length; i++) {
      const token = nameTokens[i];
      if (token === singleToken) {
        // Exact word match: 1st word = 90, 2nd word = 88, 3rd word = 86...
        const positionBonus = Math.max(0, 6 - i * 2);
        const score = 84 + positionBonus;
        return { score, matchType: "WORD_PREFIX", matchedTokens: 1, totalTokens: 1 };
      }
      if (token.startsWith(singleToken)) {
        // Word prefix match: 1st word = 88, 2nd word = 86, 3rd word = 84...
        const positionBonus = Math.max(0, 6 - i * 2);
        const score = 82 + positionBonus;
        return { score, matchType: "WORD_PREFIX", matchedTokens: 1, totalTokens: 1 };
      }
    }

    // Normalized substring match (e.g. continuous middle phrase like "cristal3d" inside "BLUECRISTAL3DENGRAVEW")
    // Only allow if query is at least 4 characters to prevent noise
    if (cleanQ.length >= 4 && normQ && normQ.length >= 4) {
      const normIdx = normC ? normC.indexOf(normQ) : -1;
      if (normIdx !== -1) {
        const penalty = Math.min(8, Math.floor(normIdx / 4));
        const score = Math.max(60, 72 - penalty);
        return { score, matchType: "NORMALIZED_SUBSTRING", matchedTokens: 1, totalTokens: 1 };
      }
    }

    // Location Match (City, State, Pincode)
    if (city && city.toLowerCase().startsWith(cleanQ)) {
      return { score: 65, matchType: "LOCATION_MATCH", matchedTokens: 1, totalTokens: 1 };
    }
    if (city && city.toLowerCase().includes(cleanQ) && cleanQ.length >= 3) {
      return { score: 55, matchType: "LOCATION_MATCH", matchedTokens: 1, totalTokens: 1 };
    }
    if (state && state.toLowerCase().startsWith(cleanQ)) {
      return { score: 60, matchType: "LOCATION_MATCH", matchedTokens: 1, totalTokens: 1 };
    }
    if (pincode && pincode.startsWith(cleanQ) && cleanQ.length >= 3) {
      return { score: 65, matchType: "LOCATION_MATCH", matchedTokens: 1, totalTokens: 1 };
    }

    // Substring containment INSIDE a word (e.g. "ind" inside "Dindigul" or "Bindal")
    // IMPORTANT: Strictly prohibited for short queries (< 5 chars) so typing "ind" or "tata" NEVER shows middle substrings!
    if (cleanQ.length >= 5) {
      const subIndex = cleanName.indexOf(cleanQ);
      if (subIndex !== -1) {
        const score = Math.max(25, 35 - Math.min(10, Math.floor(subIndex / 5)));
        return { score, matchType: "CONTAINS", matchedTokens: 1, totalTokens: 1 };
      }
    }

    // Fuzzy Guard: Only allow fuzzy if token is at least 4 chars and very close
    if (singleToken.length >= 4) {
      let maxSim = 0;
      for (const token of nameTokens) {
        if (token.length >= 3) {
          const sim = stringSimilarity(singleToken, token);
          if (sim > maxSim) maxSim = sim;
        }
      }

      if (maxSim >= 0.78) {
        const score = Math.round(maxSim * 30); // 23 - 30
        return { score, matchType: "FUZZY_MATCH", matchedTokens: 0, totalTokens: 1 };
      }
    }

    return { score: 0, matchType: "NO_MATCH", matchedTokens: 0, totalTokens: 1 };
  }

  // ── 4. MULTI-TOKEN MATCHING (e.g. "tata motor" or "fertiliser indian") ──────────
  let matchedCount = 0;
  let wordPrefixCount = 0;
  let inOrderCount = 0;
  let lastFoundIndex = -1;

  for (const qToken of qTokens) {
    let tokenMatched = false;
    for (let i = 0; i < nameTokens.length; i++) {
      const nToken = nameTokens[i];
      const isStemMatch = (qToken.length >= 4 && nToken.startsWith(qToken.slice(0, 4))) ||
                          (nToken.length >= 4 && qToken.startsWith(nToken.slice(0, 4)));

      if (nToken === qToken || isStemMatch) {
        matchedCount++;
        wordPrefixCount++;
        tokenMatched = true;
        if (i > lastFoundIndex) {
          inOrderCount++;
          lastFoundIndex = i;
        }
        break;
      } else if (nToken.startsWith(qToken)) {
        matchedCount++;
        wordPrefixCount++;
        tokenMatched = true;
        if (i > lastFoundIndex) {
          inOrderCount++;
          lastFoundIndex = i;
        }
        break;
      } else if (qToken.length >= 4 && nToken.includes(qToken)) {
        matchedCount++;
        tokenMatched = true;
        break;
      }
    }

    if (!tokenMatched) {
      if ((city && city.toLowerCase().includes(qToken)) || (state && state.toLowerCase().includes(qToken))) {
        matchedCount++;
      }
    }
  }

  // All tokens matched
  if (matchedCount >= totalTokens) {
    const isAllWordPrefix = wordPrefixCount === totalTokens;
    const isOrderPreserved = inOrderCount === totalTokens;
    
    if (isAllWordPrefix && isOrderPreserved) {
      // In-order consecutive prefix match (e.g. "tata mot" -> "Tata Motors") -> High Priority
      let score = 84;
      if (nameTokens[0] && nameTokens[0].startsWith(qTokens[0])) score += 4; // Starts from 1st word: 88
      return { score, matchType: "IN_ORDER_TOKENS_MATCH", matchedTokens: matchedCount, totalTokens };
    }

    let score = isAllWordPrefix ? 78 : 72;
    if (isOrderPreserved) score += 3;
    const extraWords = Math.max(0, nameTokens.length - qTokens.length);
    score -= Math.min(6, extraWords);

    return { score, matchType: "ALL_TOKENS_MATCH", matchedTokens: matchedCount, totalTokens };
  }

  // Multi-token continuous normalized match
  if (cleanQ.length >= 5 && normQ && normQ.length >= 5 && normC && normC.includes(normQ)) {
    const normIdx = normC.indexOf(normQ);
    const score = Math.max(55, 68 - Math.min(10, Math.floor(normIdx / 4)));
    return { score, matchType: "NORMALIZED_SUBSTRING", matchedTokens: matchedCount, totalTokens };
  }

  // Partial tokens matched (e.g. 2 of 3 tokens)
  if (matchedCount > 0 && cleanQ.length >= 4) {
    const ratio = matchedCount / totalTokens;
    const score = Math.round(ratio * 40) + (wordPrefixCount > 0 ? 5 : 0);
    return { score, matchType: "PARTIAL_TOKEN_MATCH", matchedTokens: matchedCount, totalTokens };
  }

  return { score: 0, matchType: "NO_MATCH", matchedTokens: 0, totalTokens };
}
