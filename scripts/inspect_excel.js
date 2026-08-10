import xlsxModule from "xlsx";
const XLSX = xlsxModule.default || xlsxModule;

const files = [
  { name: "ABFL", path: "C:\\Users\\bhard\\Videos\\ABFL.xlsx" },
  { name: "ICICI", path: "C:\\Users\\bhard\\Videos\\ICICI.xlsx" },
];

for (const file of files) {
  console.log(`\n=================== INSPECTING ${file.name} ===================`);
  try {
    const workbook = XLSX.readFile(file.path);
    console.log("Sheets:", workbook.SheetNames);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log("Total Rows:", jsonData.length);
    console.log("First 10 Rows:");
    console.log(jsonData.slice(0, 10));
  } catch (err) {
    console.error(`Error reading ${file.name}:`, err.message);
  }
}
