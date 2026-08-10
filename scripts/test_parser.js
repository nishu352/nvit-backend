// Quick test of the new excelParser against ICICI.xlsx
import xlsxModule from "xlsx";

const XLSX = xlsxModule.default || xlsxModule;

const iciciPath = "C:\\Users\\bhard\\Videos\\ICICI.xlsx";

console.log("Testing new excelParser logic against ICICI.xlsx...\n");

const workbook = XLSX.readFile(iciciPath);
const sheetName = workbook.SheetNames[0];
console.log("Sheet name:", sheetName);

const sheet = workbook.Sheets[sheetName];
const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

console.log("Total raw rows:", rawRows.length);
console.log("First 5 rows:", JSON.stringify(rawRows.slice(0, 5), null, 2));

// Simulate header detection
let headerRowIndex = 0;
let companyColIndex = -1;
let categoryColIndex = -1;

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
  }
  if (companyColIndex !== -1) break;
}

console.log(`\nHeader detected at row: ${headerRowIndex}`);
console.log(`Company col index: ${companyColIndex}`);
console.log(`Category col index: ${categoryColIndex}`);

// Count valid rows
let validCount = 0;
const categoryStats = {};

for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
  const row = rawRows[r];
  if (!Array.isArray(row)) continue;
  const name = String(row[companyColIndex] || "").trim();
  if (!name || name.length < 2) continue;
  if (/company\s*name|sr\.?\s*no/i.test(name)) continue;
  
  validCount++;
  const cat = String(row[categoryColIndex] || "").trim() || "UNLISTED";
  categoryStats[cat] = (categoryStats[cat] || 0) + 1;
}

console.log(`\nValid company rows: ${validCount}`);
console.log("\nCategory distribution:");
Object.entries(categoryStats)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([cat, count]) => console.log(`  ${cat}: ${count}`));
