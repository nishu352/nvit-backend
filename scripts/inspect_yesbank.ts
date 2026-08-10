import * as XLSX from "xlsx";

const CSV_PATH = "C:\\Users\\bhard\\Downloads\\company list\\company list.csv";

console.log("Inspecting:", CSV_PATH);

const workbook = XLSX.readFile(CSV_PATH, { raw: false });
console.log("Sheets:", workbook.SheetNames);

const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });

console.log("Total rows:", rawRows.length);
console.log("\nFirst 10 rows:");
rawRows.slice(0, 10).forEach((row, i) => console.log(`  [${i}]`, JSON.stringify(row)));

// Count non-empty rows
let nonEmpty = 0;
for (let i = 1; i < rawRows.length; i++) {
  const row = rawRows[i];
  if (Array.isArray(row) && row.some(c => String(c || "").trim().length > 0)) nonEmpty++;
}
console.log("\nNon-empty data rows:", nonEmpty);
