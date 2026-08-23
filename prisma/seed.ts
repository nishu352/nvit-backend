import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting seed script...");

  // Seed Default Super Admin User
  const adminPasswordHash = await bcrypt.hash("@#$512Aui", 10);
  const admin = await prisma.user.upsert({
    where: { email: "admin@nvit.space" },
    update: { password: adminPasswordHash },
    create: {
      email: "admin@nvit.space",
      name: "NVIT Super Admin",
      password: adminPasswordHash,
      role: "SUPER_ADMIN",
    },
  });
  console.log("✅ Super Admin created:", admin.email);

  // Seed standard executives
  const execPasswordHash = await bcrypt.hash("Exec@12345", 10);
  const executive = await prisma.user.upsert({
    where: { email: "executive@nvit.space" },
    update: {},
    create: {
      email: "executive@nvit.space",
      name: "Rohan Sharma (Lead Executive)",
      password: execPasswordHash,
      role: "EXECUTIVE",
    },
  });
  console.log("✅ Lead Executive created:", executive.email);

  // Seed Default Banks & NBFCs
  const banksData = [
    { name: "HDFC Bank", code: "HDFC", type: "BANK", logoUrl: "/logos/hdfc.png", priority: 1, partnerStatus: "ACTIVE", displayOrder: 1, eligibility: "Salary > 25000, Age 21-60", processingFee: 1.0 },
    { name: "ICICI Bank", code: "ICICI", type: "BANK", logoUrl: "/logos/icici.png", priority: 2, partnerStatus: "ACTIVE", displayOrder: 2, eligibility: "Salary > 20000, Age 21-58", processingFee: 1.5 },
    { name: "Axis Bank", code: "AXIS", type: "BANK", logoUrl: "/logos/axis.png", priority: 3, partnerStatus: "ACTIVE", displayOrder: 3, eligibility: "Salary > 25000, Age 21-60", processingFee: 1.25 },
    { name: "Kotak Mahindra Bank", code: "KOTAK", type: "BANK", logoUrl: "/logos/kotak.png", priority: 4, partnerStatus: "ACTIVE", displayOrder: 4, eligibility: "Salary > 30000, Age 21-58", processingFee: 1.0 },
    { name: "Bajaj Finserv", code: "BAJAJ", type: "NBFC", logoUrl: "/logos/bajaj.png", priority: 5, partnerStatus: "ACTIVE", displayOrder: 5, eligibility: "Salary > 18000, Age 23-55", processingFee: 2.0 },
    { name: "Tata Capital", code: "TATA", type: "NBFC", logoUrl: "/logos/tata.png", priority: 6, partnerStatus: "ACTIVE", displayOrder: 6, eligibility: "Salary > 20000, Age 21-58", processingFee: 1.75 },
    { name: "Yes Bank", code: "YES", type: "BANK", logoUrl: "/logos/yes.png", priority: 7, partnerStatus: "ACTIVE", displayOrder: 7, eligibility: "Salary > 25000, Age 21-60", processingFee: 1.5 },
    { name: "IDFC First Bank", code: "IDFC", type: "BANK", logoUrl: "/logos/idfc.png", priority: 8, partnerStatus: "ACTIVE", displayOrder: 8, eligibility: "Salary > 20000, Age 23-58", processingFee: 1.0 },
    { name: "Standard Chartered", code: "SCB", type: "BANK", logoUrl: "/logos/scb.png", priority: 9, partnerStatus: "ACTIVE", displayOrder: 9, eligibility: "Salary > 50000, Age 22-58", processingFee: 1.0 },
    { name: "IndusInd Bank", code: "INDUS", type: "BANK", logoUrl: "/logos/indusind.png", priority: 10, partnerStatus: "ACTIVE", displayOrder: 10, eligibility: "Salary > 25000, Age 21-60", processingFee: 1.5 },
  ];

  const bankMap: Record<string, string> = {};
  for (const b of banksData) {
    const created = await prisma.bank.upsert({
      where: { code: b.code },
      update: b,
      create: b,
    });
    bankMap[b.code] = created.id;
  }
  console.log(`✅ Seeded ${banksData.length} banks.`);

  // Seed Default Loan Products
  const productsData = [
    { bankId: bankMap["HDFC"], name: "HDFC Express Personal Loan", code: "HDFC_PL", type: "PERSONAL_LOAN", minAmount: 50000, maxAmount: 4000000, minTenure: 12, maxTenure: 60, roiRange: "10.5% - 21.0%", description: "Instant digital sanction with paperless verification." },
    { bankId: bankMap["ICICI"], name: "ICICI Instant Salary Loan", code: "ICICI_PL", type: "PERSONAL_LOAN", minAmount: 50000, maxAmount: 5000000, minTenure: 12, maxTenure: 72, roiRange: "10.75% - 19.0%", description: "Pre-approved loan offers for salary account holders." },
    { bankId: bankMap["AXIS"], name: "Axis 24x7 Quick Personal Loan", code: "AXIS_PL", type: "PERSONAL_LOAN", minAmount: 50000, maxAmount: 4000000, minTenure: 12, maxTenure: 60, roiRange: "10.49% - 22.0%", description: "Instant disbursement for existing bank customers." },
    { bankId: bankMap["KOTAK"], name: "Kotak Smart Personal Loan", code: "KOTAK_PL", type: "PERSONAL_LOAN", minAmount: 50000, maxAmount: 3500000, minTenure: 12, maxTenure: 60, roiRange: "10.99% - 24.0%", description: "Low processing charges and high tenure flexibility." },
    { bankId: bankMap["BAJAJ"], name: "Bajaj Flexi Hybrid Personal Loan", code: "BAJAJ_PL", type: "PERSONAL_LOAN", minAmount: 30000, maxAmount: 3500000, minTenure: 12, maxTenure: 84, roiRange: "11.0% - 26.0%", description: "Withdraw as you need, pay interest only on used limit." },
  ];

  for (const p of productsData) {
    if (p.bankId) {
      await prisma.loanProduct.upsert({
        where: { code: p.code },
        update: p,
        create: p,
      });
    }
  }
  console.log(`✅ Seeded loan products.`);

  // Seed Default Categories
  const categoryMaster = [
    { name: "Super A", code: "SUPER_A", description: "Top Tier MNCs, Fortune 500 & Government Navratna entities" },
    { name: "Category A", code: "CAT_A", description: "Listed bluechip firms and top private enterprises" },
    { name: "Category B", code: "CAT_B", description: "Mid-sized established corporate employers" },
    { name: "Category C", code: "CAT_C", description: "Emerging companies and startups" },
    { name: "Category D", code: "CAT_D", description: "Small enterprises with high credit underwriting scrutiny" },
    { name: "Unlisted", code: "UNLISTED", description: "Standard private limited entities not on lender lists" },
    { name: "Negative", code: "NEGATIVE", description: "Restricted or debarred employer profiles" },
  ];

  for (const c of categoryMaster) {
    await prisma.category.upsert({
      where: { code: c.code },
      update: c,
      create: c,
    });
  }
  console.log(`✅ Seeded default corporate category list.`);

  // Seed Sample Companies
  const sampleCompanies = [
    { name: "TATA CONSULTANCY SERVICES LIMITED", cin: "L22210MH1995PLC084781", status: "ACTIVE", city: "Mumbai", state: "Maharashtra", pincode: "400001" },
    { name: "INFOSYS LIMITED", cin: "L85110KA1981PLC013115", status: "ACTIVE", city: "Bengaluru", state: "Karnataka", pincode: "560100" },
    { name: "RELIANCE INDUSTRIES LIMITED", cin: "L17110MH1973PLC019786", status: "ACTIVE", city: "Mumbai", state: "Maharashtra", pincode: "400021" },
    { name: "WIPRO LIMITED", cin: "L32102KA1945PLC020800", status: "ACTIVE", city: "Bengaluru", state: "Karnataka", pincode: "560035" },
    { name: "HCL TECHNOLOGIES LIMITED", cin: "L74140DL1991PLC046369", status: "ACTIVE", city: "Noida", state: "Uttar Pradesh", pincode: "201301" },
    { name: "LARSEN AND TOUBRO LIMITED", cin: "L99999MH1946PLC004768", status: "ACTIVE", city: "Mumbai", state: "Maharashtra", pincode: "400072" },
    { name: "MAHINDRA AND MAHINDRA LIMITED", cin: "L65990MH1945PLC004558", status: "ACTIVE", city: "Mumbai", state: "Maharashtra", pincode: "400018" },
    { name: "BHARTI AIRTEL LIMITED", cin: "L74899DL1995PLC070609", status: "ACTIVE", city: "New Delhi", state: "Delhi", pincode: "110070" },
  ];

  for (const comp of sampleCompanies) {
    const createdComp = await prisma.company.upsert({
      where: { name: comp.name },
      update: comp,
      create: comp,
    });

    // Assign categories across banks
    if (bankMap["HDFC"]) {
      await prisma.companyBankCategory.upsert({
        where: { companyId_bankId: { companyId: createdComp.id, bankId: bankMap["HDFC"] } },
        update: { category: "SUPER_A", status: "APPROVED" },
        create: { companyId: createdComp.id, bankId: bankMap["HDFC"], category: "SUPER_A", status: "APPROVED" },
      });
    }
    if (bankMap["ICICI"]) {
      await prisma.companyBankCategory.upsert({
        where: { companyId_bankId: { companyId: createdComp.id, bankId: bankMap["ICICI"] } },
        update: { category: "CAT_A", status: "APPROVED" },
        create: { companyId: createdComp.id, bankId: bankMap["ICICI"], category: "CAT_A", status: "APPROVED" },
      });
    }
  }
  console.log(`✅ Seeded sample companies and category mappings.`);

  // Seed Sample Pincodes
  const samplePincodes = [
    { pincode: "110001", state: "Delhi", city: "New Delhi", area: "Connaught Place", isServiceable: true, isNegative: false, category: "PREFERRED" },
    { pincode: "400001", state: "Maharashtra", city: "Mumbai", area: "Fort / Nariman Point", isServiceable: true, isNegative: false, category: "PREFERRED" },
    { pincode: "560001", state: "Karnataka", city: "Bengaluru", area: "MG Road / Brigade Road", isServiceable: true, isNegative: false, category: "PREFERRED" },
    { pincode: "600001", state: "Tamil Nadu", city: "Chennai", area: "Parrys / George Town", isServiceable: true, isNegative: false, category: "PREFERRED" },
    { pincode: "700001", state: "West Bengal", city: "Kolkata", area: "BBD Bagh / Dalhousie", isServiceable: true, isNegative: false, category: "PREFERRED" },
    { pincode: "500001", state: "Telangana", city: "Hyderabad", area: "Afzal Gunj / Abids", isServiceable: true, isNegative: false, category: "PREFERRED" },
    { pincode: "122001", state: "Haryana", city: "Gurugram", area: "Old Gurugram / Civil Lines", isServiceable: true, isNegative: false, category: "PREFERRED" },
    { pincode: "201301", state: "Uttar Pradesh", city: "Noida", area: "Sector 1 to 11", isServiceable: true, isNegative: false, category: "PREFERRED" },
  ];

  for (const pin of samplePincodes) {
    if (bankMap["HDFC"]) {
      await prisma.pincodeServiceability.upsert({
        where: { bankId_pincode: { bankId: bankMap["HDFC"], pincode: pin.pincode } },
        update: pin,
        create: { ...pin, bankId: bankMap["HDFC"] },
      });
    }
    if (bankMap["ICICI"]) {
      await prisma.pincodeServiceability.upsert({
        where: { bankId_pincode: { bankId: bankMap["ICICI"], pincode: pin.pincode } },
        update: pin,
        create: { ...pin, bankId: bankMap["ICICI"] },
      });
    }
  }
  console.log(`✅ Seeded sample pincodes.`);

  // Seed Website CMS configurations
  const websiteCmsData = [
    {
      key: "hero",
      value: {
        title: "Intelligent Loan Policy & Corporate Category Matrix",
        subtitle: "Instantly check eligibility, FOIR limits, company classifications, and serviceability across 50+ financial institutions.",
        ctaText: "Check Eligibility Now",
        ctaUrl: "/company-check",
        logoUrl: "/logos/hero-illustration.svg",
      },
    },
    {
      key: "about",
      value: {
        mission: "To eliminate friction in loan verification processes by building a single source of truth for bank policies.",
        vision: "Real-time policy validation for every financial consultant in India.",
        description: "NVIT.SPACE is a premier financial technology platform, building state-of-the-art software systems to accelerate credit verification.",
      },
    },
    {
      key: "services",
      value: [
        { title: "Company Categorization", desc: "Instantly check bank categories for SALARIED profiles." },
        { title: "Pincode Verification", desc: "Lookup geo-serviceability criteria for all lenders." },
        { title: "Circular Digitization", desc: "Parse complex policy circulars into structured queries." },
      ],
    },
    {
      key: "testimonials",
      value: [
        { quote: "NVIT.SPACE has halved our processing timelines.", author: "Suresh R., DSA Partner" },
        { quote: "Highly accurate corporate indexing system.", author: "Neha G., Credit Manager" },
      ],
    },
    {
      key: "faqs",
      value: [
        { q: "How is the data kept accurate?", a: "By running high-frequency ingestions of official bank policy updates." },
        { q: "Can we roll back policy revisions?", a: "Yes, our Audit Logs and History systems allow 1-click rollbacks." },
      ],
    },
    {
      key: "footer",
      value: {
        copyright: "© 2026 NVIT.SPACE. All rights reserved.",
        address: "DLF Cyber City, Phase III, Gurugram, Haryana - 122002",
        contactEmail: "ops@nvit.space",
      },
    },
    {
      key: "branding",
      value: {
        companyName: "NVIT.SPACE",
        faviconUrl: "/favicon.ico",
        logoUrl: "/brand/nvit-icon-animated.svg",
        themeColors: {
          primary: "#1d4ed8",
          secondary: "#0f172a",
          accent: "#10b981",
        },
      },
    },
  ];

  for (const cms of websiteCmsData) {
    await prisma.websiteCMS.upsert({
      where: { key: cms.key },
      update: { value: cms.value },
      create: { key: cms.key, value: cms.value },
    });
  }
  console.log(`✅ Website CMS configurations seeded.`);

  // Seed Marketing Settings
  const marketingData = [
    { key: "google_ads", value: { conversionId: "AW-108293751", conversionLabels: ["apply_click", "check_click"], enabled: true } },
    { key: "google_analytics", value: { measurementId: "G-F3L9D9W5", enabled: true } },
    { key: "google_tag_manager", value: { containerId: "GTM-K2W9F9A", enabled: false } },
    { key: "meta_pixel", value: { pixelId: "98239587129571", enabled: false } },
  ];

  for (const m of marketingData) {
    await prisma.marketingSettings.upsert({
      where: { key: m.key },
      update: { value: m.value },
      create: { key: m.key, value: m.value },
    });
  }
  console.log(`✅ Marketing integrations seeded.`);

  // Seed SEO Settings
  const seoData = [
    { route: "home", title: "NVIT.SPACE - Enterprise Loan Policy Engine", description: "Instantly check corporate categories, lender policies, and pincode serviceability.", keywords: "loan policy, corporate categories, bank dsa portal" },
    { route: "company-check", title: "Verify Company Category - NVIT.SPACE", description: "Search and verify bank classifications for over 1.5 Lakh companies.", keywords: "company check, cat a companies, hdfc company list" },
    { route: "pincode-check", title: "Lender Pincode Coverage Finder - NVIT.SPACE", description: "Lookup serviceable areas for personal loans, home loans, and business loans.", keywords: "pincode checker, bank service area, negative pincodes" },
    { route: "loan-apply", title: "Apply for Personal & Business Loans - NVIT.SPACE", description: "Submit applications to matching lenders with digitized policies.", keywords: "apply loan, business loan eligibility" },
  ];

  for (const s of seoData) {
    await prisma.sEOSettings.upsert({
      where: { route: s.route },
      update: s,
      create: s,
    });
  }
  console.log(`✅ SEO page meta tags seeded.`);

  // Seed System Settings
  const systemData = [
    { key: "smtp", value: { host: "smtp.mailgun.org", port: 587, secure: false, auth: { user: "noreply@nvit.space", pass: "SMTPPass2026" } } },
    { key: "sms_gateway", value: { provider: "Twilio", sid: "AC_DEMO_SID", token: "DEMO_TOKEN", from: "+15005550006" } },
    { key: "whatsapp", value: { provider: "MetaCloudAPI", phoneNumberId: "109823091", accessToken: "EAAG_WHATSAPP_TOKEN", enabled: true } },
    { key: "storage", value: { provider: "LOCAL", maxMb: 2048 } },
    { key: "maintenance", value: { enabled: false, message: "System is undergoing critical database maintenance. We will return online shortly." } },
  ];

  for (const sys of systemData) {
    await prisma.systemSettings.upsert({
      where: { key: sys.key },
      update: { value: sys.value },
      create: { key: sys.key, value: sys.value },
    });
  }
  console.log(`✅ System settings seeded.`);

  console.log("🚀 Database seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
