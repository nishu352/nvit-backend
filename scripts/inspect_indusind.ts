import * as XLSX from "xlsx";

const FILE_PATH = "C:\\Users\\bhard\\Downloads\\Company List -Apr 2026.xlsb";
const workbook = XLSX.readFile(FILE_PATH, { type: "file" });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });

// Count all unique category values
const catStats: Record<string, number> = {};
for (let i = 1; i < rawRows.length; i++) {
  const row = rawRows[i];
  const cat = String(row[2] || "").trim();
  if (cat) catStats[cat] = (catStats[cat] || 0) + 1;
}

console.log("Total rows:", rawRows.length - 1);
console.log("\nAll IndusInd Categories:");
Object.entries(catStats).sort((a, b) => b[1] - a[1])
  .forEach(([c, n]) => console.log(`  "${c}": ${n.toLocaleString()}`));
