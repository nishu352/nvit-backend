import { normalizeCompanyName } from "./normalize.js";

export type MatchType =
  | "EXACT_MATCH"
  | "EXACT_PREFIX"
  | "WORD_PREFIX"
  | "ALL_TOKENS_MATCH"
  | "PARTIAL_TOKEN_MATCH"
  | "CONTAINS"
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
 * Calculate deterministic relevance score (0 - 100) of a company name against user search query.
 * 
 * Hierarchy:
 *  100       = Exact full match (case/space-insensitive or normalized)
 *  90 - 98   = Exact prefix match (Company name starts with user query)
 *  80 - 89   = Word prefix match (A word in company name starts with query)
 *  70 - 79   = Multi-token all-match (All query tokens match company words/prefixes)
 *  50 - 69   = Containment match (Query is a substring inside words)
 *  30 - 49   = Partial token match
 *  10 - 29   = Weak fuzzy match (Guard enabled: min 4 chars query & high similarity)
 *  0         = Irrelevant / No match
 */
export function calculateCompanyRelevance(
  companyName: string,
  query: string,
  normalizedCompany?: string,
  baseCompany?: string
): RelevanceScoreResult {
  const cleanQ = (query || "").trim().toLowerCase();
  const cleanName = (companyName || "").trim().toLowerCase();

  if (!cleanQ || !cleanName) {
    return { score: 0, matchType: "NO_MATCH", matchedTokens: 0, totalTokens: 0 };
  }

  const { normalizedName: normQ, baseName: baseQ } = normalizeCompanyName(cleanQ);
  const normC = normalizedCompany || normalizeCompanyName(cleanName).normalizedName;
  const baseC = baseCompany || normalizeCompanyName(cleanName).baseName;

  const qTokens = tokenize(cleanQ);
  const nameTokens = tokenize(cleanName);
  const totalTokens = qTokens.length;

  // ── 1. EXACT MATCH (Score: 100) ───────────────────────────────────────────
  if (
    cleanName === cleanQ ||
    (normQ && normC && normQ === normC) ||
    (baseQ && baseC && baseQ === baseC)
  ) {
    return { score: 100, matchType: "EXACT_MATCH", matchedTokens: totalTokens, totalTokens };
  }

  // ── 2. EXACT PREFIX MATCH (Score: 90 - 98) ───────────────────────────────
  // Company name starts directly with the query string (e.g. "Indus" -> "IndusInd Bank")
  if (cleanName.startsWith(cleanQ) || (normQ && normC && normC.startsWith(normQ))) {
    const lengthPenalty = Math.min(8, Math.floor((cleanName.length - cleanQ.length) / 8));
    const score = Math.max(90, 98 - lengthPenalty);
    return { score, matchType: "EXACT_PREFIX", matchedTokens: totalTokens, totalTokens };
  }

  // ── 3. WORD PREFIX MATCH (Single Token Query) ────────────────────────────
  // e.g. "indus" -> "ABC Indus Finance" (word 1 starts with "indus")
  if (totalTokens === 1) {
    const singleToken = qTokens[0];
    for (let i = 0; i < nameTokens.length; i++) {
      const token = nameTokens[i];
      if (token.startsWith(singleToken)) {
        // Earlier word position = higher relevance
        const positionBonus = Math.max(0, 6 - i * 2); // Word 0: +6, Word 1: +4, Word 2: +2
        const exactWordBonus = token === singleToken ? 3 : 0;
        const score = 80 + positionBonus + exactWordBonus;
        return { score, matchType: "WORD_PREFIX", matchedTokens: 1, totalTokens: 1 };
      }
    }

    // ── Substring Containment (Inside word e.g. "Hindustan" contains "indus")
    const subIndex = cleanName.indexOf(cleanQ);
    if (subIndex !== -1) {
      // Substring found inside a word (not at word start)
      // Rank significantly lower than word start (Score 50-65)
      const score = Math.max(50, 65 - Math.min(15, Math.floor(subIndex / 3)));
      return { score, matchType: "CONTAINS", matchedTokens: 1, totalTokens: 1 };
    }

    // ── Fuzzy Guard: Only allow fuzzy if token is at least 4 chars and very close
    if (singleToken.length >= 4) {
      let maxSim = 0;
      for (const token of nameTokens) {
        if (token.length >= 3) {
          const sim = stringSimilarity(singleToken, token);
          if (sim > maxSim) maxSim = sim;
        }
      }

      // Threshold: minimum 75% similarity required
      if (maxSim >= 0.75) {
        const score = Math.round(maxSim * 35); // 26 - 35
        return { score, matchType: "FUZZY_MATCH", matchedTokens: 0, totalTokens: 1 };
      }
    }

    return { score: 0, matchType: "NO_MATCH", matchedTokens: 0, totalTokens: 1 };
  }

  // ── 4. MULTI-TOKEN MATCHING (e.g. "mahindra finance") ─────────────────────
  let matchedCount = 0;
  let wordPrefixCount = 0;
  let inOrderCount = 0;
  let lastFoundIndex = -1;

  for (const qToken of qTokens) {
    let tokenMatched = false;
    for (let i = 0; i < nameTokens.length; i++) {
      const nToken = nameTokens[i];
      const isStemMatch = (qToken.length >= 5 && nToken.startsWith(qToken.slice(0, 5))) ||
                          (nToken.length >= 5 && qToken.startsWith(nToken.slice(0, 5)));

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
      } else if (nToken.includes(qToken)) {
        matchedCount++;
        tokenMatched = true;
        break;
      }
    }
  }

  // All tokens matched
  if (matchedCount === totalTokens) {
    const isAllWordPrefix = wordPrefixCount === totalTokens;
    const isOrderPreserved = inOrderCount === totalTokens;
    let score = isAllWordPrefix ? 85 : 75;
    if (isOrderPreserved) score += 4;
    // Length penalty for bloated names
    const extraWords = Math.max(0, nameTokens.length - qTokens.length);
    score -= Math.min(6, extraWords);

    return { score, matchType: "ALL_TOKENS_MATCH", matchedTokens: matchedCount, totalTokens };
  }

  // Partial tokens matched (e.g. 1 of 2 tokens)
  if (matchedCount > 0) {
    const ratio = matchedCount / totalTokens;
    const score = Math.round(ratio * 45) + (wordPrefixCount > 0 ? 5 : 0);
    return { score, matchType: "PARTIAL_TOKEN_MATCH", matchedTokens: matchedCount, totalTokens };
  }

  // Multi-token fuzzy fallback (only if query is substantial)
  if (cleanQ.length >= 6) {
    const overallSim = stringSimilarity(cleanQ, cleanName);
    if (overallSim >= 0.70) {
      const score = Math.round(overallSim * 25);
      return { score, matchType: "FUZZY_MATCH", matchedTokens: 0, totalTokens };
    }
  }

  return { score: 0, matchType: "NO_MATCH", matchedTokens: 0, totalTokens };
}
