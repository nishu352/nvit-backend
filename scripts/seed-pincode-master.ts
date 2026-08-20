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

  console.log(`Starting replacement of Pan-India Pincode Master from: ${filePath}`);
  const startTime = Date.now();

  // 1. Wipe existing master data to ensure a clean replace
  console.log("Wiping existing PincodeMaster records for full replace...");
  const deleteResult = await prisma.pincodeMaster.deleteMany({});
  console.log(`Cleared ${deleteResult.count.toLocaleString()} old records.`);

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

    // Parse CSV line handling quotes
    const match = line.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g);
    if (!match || match.length < 9) continue;

    const parts = match.map((m) =>
      m.replace(/^,/, "").replace(/^"/, "").replace(/"$/, "").trim()
    );

    const officeName = parts[3]; // officename column
    const rawPincode = parts[4]; // pincode column
    const district = parts[7];   // district column
    const state = parts[8];      // statename column

    const cleanPincode = String(rawPincode || "").padStart(6, "0");
    if (!cleanPincode || cleanPincode.length !== 6 || isNaN(Number(cleanPincode))) {
      continue;
    }

    const cleanState = toTitleCase(state);
    const cleanDistrict = toTitleCase(district);
    const cleanOffice = officeName.trim();

    if (!pincodeMap.has(cleanPincode)) {
      const officeSet = new Set<string>();
      if (cleanOffice) officeSet.add(cleanOffice);

      pincodeMap.set(cleanPincode, {
        pincode: cleanPincode,
        state: cleanState,
        district: cleanDistrict,
        city: cleanDistrict,
        primaryOffice: cleanOffice,
        offices: officeSet,
      });
    } else {
      const entry = pincodeMap.get(cleanPincode)!;
      if (cleanOffice && entry.offices.size < 25) {
        entry.offices.add(cleanOffice);
      }
    }
  }

  console.log(`Parsed ${lineCount.toLocaleString()} post offices from CSV.`);
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

  console.log(`Inserting fresh master records into database in chunks of ${CHUNK_SIZE}...`);
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
  console.log(`\n🎉 Successfully replaced master directory with ${inserted.toLocaleString()} Pan-India Pincodes in ${durationSec}s!`);
}

seedPincodeMaster()
  .catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
