export interface NormalizedCompany {
  normalizedName: string;
  baseName: string;
}

/**
 * Standardize and normalize company names across India's banking sector.
 * Converts corporate suffixes (PRIVATE LIMITED -> PVTLTD, LIMITED -> LTD, etc.)
 * Returns both the standard normalized name (with suffix) and the base name (no suffix).
 */
export function normalizeCompanyName(name: string): NormalizedCompany {
  if (!name) return { normalizedName: "", baseName: "" };
  let clean = name.toUpperCase().trim();

  // Replace multiple whitespace with single space
  clean = clean.replace(/\s+/g, " ");

  // Standardize common corporate suffixes and words before stripping punctuation
  clean = clean
    .replace(/\bPRIVATE LIMITED\b/g, "PVT LTD")
    .replace(/\bPRIVATELIMITED\b/g, "PVTLTD")
    .replace(/\bPRIVATE LTD\b/g, "PVT LTD")
    .replace(/\bPVT LIMITED\b/g, "PVT LTD")
    .replace(/\bP LTD\b/g, "PVT LTD")
    .replace(/\bP\.? LTD\.?\b/g, "PVT LTD")
    .replace(/\bPVT\.?\b/g, "PVT")
    .replace(/\bLIMITED\b/g, "LTD")
    .replace(/\bLTD\.\b/g, "LTD")
    .replace(/\bCORPORATION\b/g, "CORP")
    .replace(/\bINCORPORATED\b/g, "INC")
    .replace(/\bTECHNOLOGIES\b/g, "TECH")
    .replace(/\bTECHNOLOGY\b/g, "TECH")
    .replace(/\bSERVICES\b/g, "SERVICE")
    .replace(/\bSOLUTIONS\b/g, "SOLUTION")
    .replace(/\bAND\b/g, "AND")
    .replace(/&/g, "AND");

  // Create baseName by stripping standard corporate suffixes entirely
  let baseName = clean
    .replace(/\bPVT LTD\b/g, "")
    .replace(/\bPVTLTD\b/g, "")
    .replace(/\bPVT\b/g, "")
    .replace(/\bLTD\b/g, "")
    .replace(/\bINC\b/g, "")
    .replace(/\bCORP\b/g, "")
    .replace(/\bLLP\b/g, "")
    .replace(/\bPLC\b/g, "");

  // Remove all non-alphanumeric characters for both
  const normalizedName = clean.replace(/[^A-Z0-9]/g, "");
  baseName = baseName.replace(/[^A-Z0-9]/g, "");

  return {
    normalizedName,
    baseName,
  };
}
