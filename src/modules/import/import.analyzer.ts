import * as XLSX from "xlsx";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ColumnInfo {
  index: number;
  header: string;
  dataType: "string" | "number" | "date" | "empty" | "mixed";
  sampleValues: string[];
  nullCount: number;
  fillRate: number; // 0-1
}

export interface FileSchema {
  fileName: string;
  sheetName: string;
  sheetCount: number;
  rowCount: number;
  columnCount: number;
  columns: ColumnInfo[];
  sampleRows: Record<string, string>[]; // 10 sanitized rows for preview
}

export interface AnalyzeResult {
  schema: FileSchema;
  rawRows: Record<string, string>[]; // ALL rows for session storage (server-side only)
  inFileDuplicates: number; // count of duplicate company names detected in file
}

// ─── Prompt Injection Protection ────────────────────────────────────────────

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instruction/i,
  /forget\s+(everything|all)/i,
  /you\s+are\s+now\s+a/i,
  /act\s+as\s+(a\s+)?/i,
  /new\s+persona/i,
  /delete\s+(the\s+)?(database|all\s+record|everything)/i,
  /drop\s+table/i,
  /truncate\s+table/i,
  /exec\s*\(/i,
  /system\s*\(/i,
  /execute\s+sql/i,
  /update\s+users?\s+set/i,
  /insert\s+into\s+users/i,
  /\bpassword\b.*=.*\b/i,
  /access\s+the\s+database/i,
  /reveal\s+(your\s+)?(system|secret|key|password|credential)/i,
];

function sanitizeCellValue(raw: string): string {
  const value = raw.trim();

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(value)) {
      return "[REDACTED]";
    }
  }

  // Truncate very long values (prevent sending huge data to AI)
  if (value.length > 300) {
    return value.substring(0, 300) + "…";
  }

  return value;
}

// ─── Data Type Detection ─────────────────────────────────────────────────────

function detectDataType(values: string[]): ColumnInfo["dataType"] {
  const nonEmpty = values.filter((v) => v && v.trim() !== "" && v !== "[REDACTED]");
  if (nonEmpty.length === 0) return "empty";

  const numCount = nonEmpty.filter((v) => !isNaN(Number(v)) && v.trim() !== "").length;
  const dateCount = nonEmpty.filter((v) => {
    if (!isNaN(Number(v))) return false;
    const d = new Date(v);
    return !isNaN(d.getTime());
  }).length;

  const total = nonEmpty.length;
  if (numCount === total) return "number";
  if (dateCount / total > 0.7) return "date";
  if (numCount / total > 0.8) return "number";
  if (numCount === 0 && dateCount === 0) return "string";
  return "mixed";
}

// ─── File Type Validation ─────────────────────────────────────────────────────

function validateFileType(buffer: Buffer, fileName: string): void {
  const ext = (fileName.split(".").pop() || "").toLowerCase();

  if (!["xlsx", "xls", "csv"].includes(ext)) {
    throw new Error(
      `Unsupported file type: .${ext}. Only .xlsx, .xls, and .csv files are accepted.`
    );
  }

  // Magic byte validation (prevent extension spoofing)
  if (ext === "xlsx") {
    // XLSX/ZIP magic: PK\x03\x04
    if (!(buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04)) {
      throw new Error("File content does not match .xlsx format. Possible spoofed file type.");
    }
  } else if (ext === "xls") {
    // XLS/CFBF magic: D0 CF 11 E0
    if (!(buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0)) {
      throw new Error("File content does not match .xls format. Possible spoofed file type.");
    }
  }
  // CSV: no magic bytes — rely on extension only
}

// ─── Main Analysis Function ───────────────────────────────────────────────────
//
// MEMORY STRATEGY:
//  - Single XLSX.read pass (not two) — eliminates double memory usage
//  - workbook freed immediately after sheet_to_json
//  - rawMatrix freed immediately after dataMatrix is sliced
//  - dataMatrix freed (length=0) after rawRows are built
//  - rawRows + inline duplicate detection in ONE loop
//
// This prevents OOM crashes on 70,000+ row files (previously crashed at ~4GB)

export function analyzeFileBuffer(buffer: Buffer, fileName: string): AnalyzeResult {
  // 1. Validate file type/extension/magic bytes
  validateFileType(buffer, fileName);

  // 2. Single-pass workbook parse — ALL rows, once only
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: false,   // Raw strings — much faster & less memory than cellDates:true
      cellFormula: false, // Never execute formulas
      cellHTML: false,    // Never render HTML cells
      sheetRows: 0,       // All rows
    });
  } catch (err: any) {
    throw new Error(`Failed to parse file: ${err.message}. Ensure the file is not password-protected or corrupted.`);
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error("The uploaded file contains no sheets.");
  }

  const sheetCount = workbook.SheetNames.length;
  const sheetName = workbook.SheetNames[0]; // Always use first sheet
  const sheet = workbook.Sheets[sheetName];

  // 3. Convert to 2D array
  let rawMatrix: any[][] = XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });

  // Free workbook immediately — rawMatrix is all we need
  (workbook as any) = null;

  if (rawMatrix.length < 2) {
    throw new Error("File contains insufficient data. At least a header row and one data row are required.");
  }

  // 4. Find header row — first row with ≥2 non-empty cells
  let headerRowIndex = 0;
  for (let i = 0; i < Math.min(10, rawMatrix.length); i++) {
    const row = rawMatrix[i];
    if (!Array.isArray(row)) continue;
    const nonEmpty = row.filter((c) => String(c || "").trim() !== "").length;
    if (nonEmpty >= 2) {
      headerRowIndex = i;
      break;
    }
  }

  const headerRow = (rawMatrix[headerRowIndex] as any[]).map((h) => String(h || "").trim());

  // Build dataMatrix and immediately null rawMatrix to free header rows from memory
  let dataMatrix: any[][] = rawMatrix.slice(headerRowIndex + 1).filter(
    (row) => Array.isArray(row) && row.some((c) => String(c || "").trim() !== "")
  );
  (rawMatrix as any) = null; // Free — GC can reclaim header rows now

  if (dataMatrix.length === 0) {
    throw new Error("No data rows found below the header row.");
  }

  if (dataMatrix.length > 500000) {
    throw new Error(`File contains ${dataMatrix.length.toLocaleString()} rows which exceeds the 500,000 row limit.`);
  }

  const totalRows = dataMatrix.length;

  // 5. Build column info — sample first 100 rows only for type detection
  const columns: ColumnInfo[] = [];
  for (let ci = 0; ci < headerRow.length; ci++) {
    const header = headerRow[ci];
    if (!header) continue; // Skip unnamed columns

    const colValues = dataMatrix.slice(0, 100).map((row) =>
      sanitizeCellValue(String(Array.isArray(row) ? row[ci] ?? "" : ""))
    );

    const nonEmpty = colValues.filter((v) => v !== "" && v !== "[REDACTED]");
    const nullCount = colValues.filter((v) => v === "").length;

    columns.push({
      index: ci,
      header,
      dataType: detectDataType(nonEmpty),
      sampleValues: nonEmpty.slice(0, 5),
      nullCount,
      fillRate: colValues.length > 0 ? (colValues.length - nullCount) / colValues.length : 0,
    });
  }

  if (columns.length === 0) {
    throw new Error("No valid column headers detected. Ensure the file has a proper header row.");
  }

  // 6. Build sample rows (10 rows, sanitized — sent to client for preview)
  const sampleRows: Record<string, string>[] = dataMatrix.slice(0, 10).map((row) => {
    const record: Record<string, string> = {};
    for (const col of columns) {
      const rawVal = String(Array.isArray(row) ? row[col.index] ?? "" : "");
      record[col.header] = sanitizeCellValue(rawVal.trim());
    }
    return record;
  });

  // 7. Build rawRows + count duplicates in ONE loop, then free dataMatrix
  // Pre-allocate array for better performance on large datasets
  const rawRows: Record<string, string>[] = new Array(totalRows);
  const companyColHeader = columns[0]?.header || "";
  const seen = new Set<string>();
  let inFileDuplicates = 0;

  for (let ri = 0; ri < totalRows; ri++) {
    const row = dataMatrix[ri];
    const record: Record<string, string> = {};
    for (const col of columns) {
      record[col.header] = String(Array.isArray(row) ? row[col.index] ?? "" : "").trim();
    }
    rawRows[ri] = record;

    // Inline duplicate detection — avoids a second pass over rawRows
    const val = (record[companyColHeader] || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (val) {
      if (seen.has(val)) { inFileDuplicates++; }
      else { seen.add(val); }
    }
  }

  // Free dataMatrix — GC can reclaim the 2D source array
  dataMatrix.length = 0;
  (dataMatrix as any) = null;

  return {
    schema: {
      fileName,
      sheetName,
      sheetCount,
      rowCount: totalRows,
      columnCount: columns.length,
      columns,
      sampleRows,
    },
    rawRows,
    inFileDuplicates,
  };
}
