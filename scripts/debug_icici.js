import xlsxModule from "xlsx";
import fs from "fs";

const XLSX = xlsxModule.default || xlsxModule;

const iciciPath = "C:\\Users\\bhard\\Videos\\ICICI.xlsx";

console.log("Reading ICICI.xlsx to check parsed headers...");
const wb = XLSX.readFile(iciciPath);
console.log("Sheet names:", wb.SheetNames);

const sheet = wb.Sheets[wb.SheetNames[0]];

// Method 1: sheet_to_json with header auto-detection (like import service does)
const jsonAutoHeader = XLSX.utils.sheet_to_json(sheet, { defval: "" });
console.log("\n--- JSON with auto-headers (first 3 rows) ---");
console.log(JSON.stringify(jsonAutoHeader.slice(0, 3), null, 2));

// Method 2: raw row-by-row (like process_excel_companies.js does)
const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
console.log("\n--- Raw rows (first 5 rows) ---");
console.log(JSON.stringify(rawRows.slice(0, 5), null, 2));

console.log("\nTotal auto-header rows:", jsonAutoHeader.length);
console.log("Total raw rows:", rawRows.length);
