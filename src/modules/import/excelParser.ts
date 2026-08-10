import * as XLSX from "xlsx";

export interface ParsedCompanyRow {
  companyName: string;
  category: string;
  status?: string;
  remarks?: string;
  cin?: string;
}

/**
 * Normalizes bank-specific category names to standard CAT A/B/C format.
 * 
 * ICICI (Aug 2025): "Superprime", "Elite", "Preferred", "Open Market", "Government"
 * ABFL: "A", "B", "C"
 * Generic: "CAT A", "CAT B", "CAT C"
 */
function normalizeCategory(raw: string): string {
  if (!raw) return "UNLISTED";
  const cat = raw.trim().toUpperCase();

  // Already in CAT A/B/C format
  if (cat === "CAT A" || cat === "A") return "CAT A";
  if (cat === "CAT B" || cat === "B") return "CAT B";
  if (cat === "CAT C" || cat === "C") return "CAT C";

  // ICICI August 2025 tiers
  if (cat === "SUPERPRIME" || cat === "SUPER PRIME") return "CAT A";
  if (cat === "ELITE") return "CAT A";
  if (cat === "PREFERRED" || cat === "PRIME") return "CAT B";
  if (cat === "OPEN MARKET" || cat === "OPENMARKET" || cat === "OPEN-MARKET") return "CAT C";

  // Government / Public sector
  if (cat === "GOVERNMENT" || cat === "GOVT" || cat === "GOV") return "CAT A";
  if (cat === "PSU" || cat.includes("PUBLIC SECTOR")) return "CAT A";
  if (cat === "MNC" || cat.includes("MULTI NATIONAL")) return "CAT A";

  // Reject categories
  if (cat.includes("REJECT") || cat === "NL" || cat === "NOT LISTED" || cat === "BLACKLIST") return "REJECT";

  // Unlisted
  if (cat === "UNLISTED" || cat === "N/A" || cat === "NA" || cat === "") return "UNLISTED";

  // Preserve custom/bank-specific category values as-is (uppercased)
  return cat;
}

export function parseExcelOrCsvBuffer(buffer: Buffer): ParsedCompanyRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Uploaded Excel spreadsheet contains no active sheets");
  }

  const sheet = workbook.Sheets[sheetName];

  // Use header:1 (raw array mode) to avoid issues with empty leading columns
  // that cause XLSX to generate "__EMPTY" keys and mess up column detection
  const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });

  if (rawRows.length === 0) {
    throw new Error("Uploaded file contains no data rows");
  }

  // Find header row — the first row that has a cell matching "company" pattern
  let headerRowIndex = 0;
  let companyColIndex = -1;
  let categoryColIndex = -1;
  let remarksColIndex = -1;
  let statusColIndex = -1;
  let cinColIndex = -1;

  for (let r = 0; r < Math.min(10, rawRows.length); r++) {
    const row = rawRows[r];
    if (!Array.isArray(row)) continue;

    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || "").trim().toLowerCase();
      if (/company\s*name|company|employer/.test(cell) && companyColIndex === -1) {
        companyColIndex = c;
        headerRowIndex = r;
      }
      if (/category|cat|tier|policy/.test(cell) && categoryColIndex === -1) {
        categoryColIndex = c;
      }
      if (/remark|comment|note/.test(cell) && remarksColIndex === -1) {
        remarksColIndex = c;
      }
      if (/status|state|approval/.test(cell) && statusColIndex === -1) {
        statusColIndex = c;
      }
      if (/cin|reg\s*no/.test(cell) && cinColIndex === -1) {
        cinColIndex = c;
      }
    }

    if (companyColIndex !== -1) break;
  }

  if (companyColIndex === -1) {
    throw new Error(
      "Could not detect 'Company Name' column. Ensure the file has a header row with a 'Company Name' or 'Company' column."
    );
  }

  const parsedRows: ParsedCompanyRow[] = [];

  // Start parsing from the row after the header
  for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!Array.isArray(row)) continue;

    const rawName = String(row[companyColIndex] || "").trim();
    if (!rawName || rawName.length < 2) continue;

    // Skip rows that look like sub-headers or separators
    if (/company\s*name|sr\.?\s*no/i.test(rawName)) continue;

    const rawCategory = categoryColIndex >= 0 ? String(row[categoryColIndex] || "").trim() : "";
    const rawStatus = statusColIndex >= 0 ? String(row[statusColIndex] || "").trim() : "";
    const rawRemarks = remarksColIndex >= 0 ? String(row[remarksColIndex] || "").trim() : "";
    const rawCin = cinColIndex >= 0 ? String(row[cinColIndex] || "").trim() : "";

    const category = normalizeCategory(rawCategory || "UNLISTED");
    const status = rawStatus.toUpperCase().includes("REJECT") || category === "REJECT"
      ? "REJECT"
      : (rawStatus || "APPROVED").toUpperCase();

    parsedRows.push({
      companyName: rawName,
      category,
      status,
      remarks: rawRemarks || undefined,
      cin: rawCin || undefined,
    });
  }

  if (parsedRows.length === 0) {
    throw new Error(
      "No valid company rows found. Check that the Company Name column contains actual company names."
    );
  }

  return parsedRows;
}
