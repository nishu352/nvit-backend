import fs from "fs";
import readline from "readline";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function toTitleCase(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .trim();
}

async function seedPincodeMaster() {
  const filePath = "C:\\Users\\bhard\\Downloads\\pincode pan india.csv";
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`Starting ingestion of Pan-India Pincodes from: ${filePath}`);
  const startTime = Date.now();

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let lineCount = 0;
  // Map: pincode -> { pincode, state, district, city, primaryOffice, allOffices: Set }
  const pincodeMap = new Map<
    string,
    {
      pincode: string;
      state: string;
      district: string;
      city: string;
      primaryOffice: string;
      offices: Set<string>;
    }
  >();

  for await (const line of rl) {
    lineCount++;
    if (lineCount === 1) continue; // Skip header

    // Quick regex for CSV with quotes
    const match = line.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g);
    if (!match || match.length < 9) continue;

    const parts = match.map((m) =>
      m.replace(/^,/, "").replace(/^"/, "").replace(/"$/, "").trim()
    );

    const officeName = parts[3];
    const rawPincode = parts[4];
    const district = parts[7];
    const state = parts[8];

    const cleanPincode = String(rawPincode || "").padStart(6, "0");
    if (!cleanPincode || cleanPincode.length !== 6 || isNaN(Number(cleanPincode))) {
      continue;
    }

    const cleanState = toTitleCase(state);
    const cleanDistrict = toTitleCase(district);
    const cleanOffice = officeName ? officeName.replace(/ B\.O$| S\.O$| H\.O$/i, "").trim() : "";

    if (!pincodeMap.has(cleanPincode)) {
      const officeSet = new Set<string>();
      if (cleanOffice) officeSet.add(cleanOffice);

      pincodeMap.set(cleanPincode, {
        pincode: cleanPincode,
        state: cleanState,
        district: cleanDistrict,
        city: cleanDistrict, // Primary city defaults to district
        primaryOffice: cleanOffice || cleanDistrict,
        offices: officeSet,
      });
    } else {
      const entry = pincodeMap.get(cleanPincode)!;
      if (cleanOffice && entry.offices.size < 20) {
        entry.offices.add(cleanOffice);
      }
    }
  }

  console.log(`Parsed ${lineCount.toLocaleString()} post offices.`);
  console.log(`Aggregated ${pincodeMap.size.toLocaleString()} unique 6-digit Indian Pincodes.`);

  const records = Array.from(pincodeMap.values()).map((p) => ({
    pincode: p.pincode,
    state: p.state,
    district: p.district,
    city: p.city,
    primaryOffice: p.primaryOffice,
    allOffices: Array.from(p.offices).join(", "),
  }));

  // Batch insert into PostgreSQL
  const CHUNK_SIZE = 2000;
  let inserted = 0;

  console.log(`Inserting into database in chunks of ${CHUNK_SIZE}...`);
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    const result = await prisma.pincodeMaster.createMany({
      data: chunk,
      skipDuplicates: true,
    });
    inserted += result.count;
    console.log(`Inserted ${inserted.toLocaleString()} / ${records.length.toLocaleString()} pincodes...`);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n🎉 Successfully loaded ${inserted.toLocaleString()} Pan-India Pincodes into database in ${durationSec}s!`);
}

seedPincodeMaster()
  .catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
