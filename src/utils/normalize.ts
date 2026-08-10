/**
 * Standardize and normalize company names across India's banking sector.
 * Converts corporate suffixes (PRIVATE LIMITED -> PVT LTD, LIMITED -> LTD, etc.)
 * so that variants like "PROVANA INDIA PRIVATE LIMITED" and "PROVANA INDIA PVT LTD"
 * normalize to the exact same hash: "PROVANAINDIAPVTLTD".
 */
export function normalizeCompanyName(name: string): string {
  if (!name) return "";
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
    .replace(/\bSOLUTIONS\b/g, "SOLUTION");

  // Remove all non-alphanumeric characters
  return clean.replace(/[^A-Z0-9]/g, "");
}
