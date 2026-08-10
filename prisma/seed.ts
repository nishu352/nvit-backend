import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting seed script...");

  // Seed Default Super Admin User
  const adminPasswordHash = await bcrypt.hash("Admin@12345", 10);
  const admin = await prisma.user.upsert({
    where: { email: "admin@finolink.co" },
    update: {},
    create: {
      email: "admin@finolink.co",
      name: "FinoLink Super Admin",
      password: adminPasswordHash,
      role: "SUPER_ADMIN",
    },
  });
  console.log("✅ Super Admin created:", admin.email);

  // Seed standard executives
  const execPasswordHash = await bcrypt.hash("Exec@12345", 10);
  const executive = await prisma.user.upsert({
    where: { email: "executive@finolink.co" },
    update: {},
    create: {
      email: "executive@finolink.co",
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
    { name: "State Bank of India", code: "SBI", type: "BANK", logoUrl: "/logos/sbi.png", priority: 3, partnerStatus: "ACTIVE", displayOrder: 3, eligibility: "Salary > 18000, Age 21-65", processingFee: 0.5 },
    { name: "Axis Bank", code: "AXIS", type: "BANK", logoUrl: "/logos/axis.png", priority: 4, partnerStatus: "ACTIVE", displayOrder: 4, eligibility: "Salary > 22000, Age 21-60", processingFee: 1.25 },
    { name: "Bajaj Finserv", code: "BAJAJ", type: "NBFC", logoUrl: "/logos/bajaj.png", priority: 5, partnerStatus: "ACTIVE", displayOrder: 5, eligibility: "Salary > 30000, Age 23-55", processingFee: 2.0 },
    { name: "Tata Capital", code: "TATA", type: "NBFC", logoUrl: "/logos/tata.png", priority: 6, partnerStatus: "ACTIVE", displayOrder: 6, eligibility: "Salary > 25000, Age 22-58", processingFee: 1.75 },
    { name: "Kotak Mahindra Bank", code: "KOTAK", type: "BANK", logoUrl: "/logos/kotak.png", priority: 7, partnerStatus: "ACTIVE", displayOrder: 7, eligibility: "Salary > 25000, Age 21-60", processingFee: 1.0 },
  ];

  const createdBanks = [];
  for (const bank of banksData) {
    const b = await prisma.bank.upsert({
      where: { code: bank.code },
      update: {
        priority: bank.priority,
        partnerStatus: bank.partnerStatus,
        displayOrder: bank.displayOrder,
        eligibility: bank.eligibility,
        processingFee: bank.processingFee,
      },
      create: bank,
    });
    createdBanks.push(b);
  }
  console.log(`✅ ${createdBanks.length} Banks & NBFCs seeded.`);

  // Seed Sample Companies
  const sampleCompanies = [
    "TATA CONSULTANCY SERVICES LIMITED",
    "INFOSYS LIMITED",
    "RELIANCE INDUSTRIES LIMITED",
    "HDFC BANK LIMITED",
    "WIPRO LIMITED",
    "BHARTI AIRTEL LIMITED",
    "ICICI BANK LIMITED",
    "LARSEN AND TOUBRO LIMITED",
    "HINDUSTAN UNILEVER LIMITED",
    "TECH MAHINDRA LIMITED",
  ];

  for (const companyName of sampleCompanies) {
    const normalizedName = companyName.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const company = await prisma.company.upsert({
      where: { normalizedName },
      update: {},
      create: {
        name: companyName,
        normalizedName,
      },
    });

    // Assign categories across banks
    for (const bank of createdBanks) {
      const categories = ["CAT A", "CAT B", "CAT C", "CAT A", "UNLISTED"];
      const randomCat = categories[Math.floor(Math.random() * categories.length)];

      await prisma.companyBankCategory.upsert({
        where: {
          companyId_bankId: {
            companyId: company.id,
            bankId: bank.id,
          },
        },
        update: {},
        create: {
          companyId: company.id,
          bankId: bank.id,
          category: randomCat,
          status: randomCat === "REJECT" ? "BLOCKED" : "APPROVED",
          remarks: `Standard ${bank.name} classification for ${companyName}`,
        },
      });
    }
  }
  console.log(`✅ Sample Companies & Category mappings seeded.`);

  // Seed Sample Pincodes
  const samplePincodes = [
    { pincode: "110001", state: "Delhi", city: "New Delhi", area: "Connaught Place" },
    { pincode: "400001", state: "Maharashtra", city: "Mumbai", area: "Fort" },
    { pincode: "560001", state: "Karnataka", city: "Bengaluru", area: "MG Road" },
    { pincode: "600001", state: "Tamil Nadu", city: "Chennai", area: "George Town" },
    { pincode: "700001", state: "West Bengal", city: "Kolkata", area: "BBD Bagh" },
    { pincode: "122001", state: "Haryana", city: "Gurugram", area: "DLF Cyber City" },
    { pincode: "201301", state: "Uttar Pradesh", city: "Noida", area: "Sector 18" },
  ];

  for (const pin of samplePincodes) {
    for (const bank of createdBanks) {
      await prisma.pincodeServiceability.upsert({
        where: {
          bankId_pincode: {
            bankId: bank.id,
            pincode: pin.pincode,
          },
        },
        update: {},
        create: {
          bankId: bank.id,
          pincode: pin.pincode,
          state: pin.state,
          city: pin.city,
          area: pin.area,
          isServiceable: true,
          isNegative: false,
          category: "PREFERRED",
        },
      });
    }
  }
  console.log(`✅ Sample Pincode serviceability records seeded.`);

  // Seed Website CMS
  const websiteCmsData = [
    {
      key: "hero",
      value: {
        headline: "Instant Policy & Verification Gateway",
        subtitle: "India's first automated loan policy circular index for financial consultants & bank DSAs.",
        primaryButton: "Search Companies",
        secondaryButton: "Check Pincodes",
        logoUrl: "/logos/hero-illustration.svg",
      },
    },
    {
      key: "about",
      value: {
        mission: "To eliminate friction in loan verification processes by building a single source of truth for bank policies.",
        vision: "Real-time policy validation for every financial consultant in India.",
        description: "FINOLINK Business Consulting Pvt. Ltd. is a premier financial advisory firm, building state-of-the-art software systems to accelerate credit verification.",
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
        { quote: "FINOLINK CMS has halved our processing timelines.", author: "Suresh R., DSA Partner" },
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
        copyright: "© 2026 FINOLINK Business Consulting Pvt. Ltd. All rights reserved.",
        address: "DLF Cyber City, Phase III, Gurugram, Haryana - 122002",
        contactEmail: "ops@finolink.co",
      },
    },
    {
      key: "branding",
      value: {
        companyName: "FINOLINK Business Consulting",
        faviconUrl: "/favicon.ico",
        logoUrl: "/logos/finolink.png",
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
    { route: "home", title: "FINOLINK - Enterprise Loan Policy Engine", description: "Instantly check corporate categories, lender policies, and pincode serviceability.", keywords: "loan policy, corporate categories, bank dsa portal" },
    { route: "company-check", title: "Verify Company Category - FINOLINK", description: "Search and verify bank classifications for over 1.5 Lakh companies.", keywords: "company check, cat a companies, hdfc company list" },
    { route: "pincode-check", title: "Lender Pincode Coverage Finder - FINOLINK", description: "Lookup serviceable areas for personal loans, home loans, and business loans.", keywords: "pincode checker, bank service area, negative pincodes" },
    { route: "loan-apply", title: "Apply for Personal & Business Loans - FINOLINK", description: "Submit applications to matching lenders with digitized policies.", keywords: "apply loan, business loan eligibility" },
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
    { key: "smtp", value: { host: "smtp.mailgun.org", port: 587, secure: false, auth: { user: "noreply@finolink.co", pass: "SMTPPass2026" } } },
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
  console.log(`✅ System gateway settings seeded.`);

  // Seed Bank Policies & Loan Products
  for (const bank of createdBanks) {
    // 1. Bank Policies for categories
    const categories = ["CAT A", "CAT B", "CAT C", "UNLISTED"];
    for (const cat of categories) {
      await prisma.bankPolicy.create({
        data: {
          bankId: bank.id,
          companyCategory: cat,
          minSalary: cat === "CAT A" ? 20000 : cat === "CAT B" ? 25000 : cat === "CAT C" ? 30000 : 40000,
          maxSalary: 99999999,
          minAge: 21,
          maxAge: 60,
          foir: cat === "CAT A" ? 65.0 : cat === "CAT B" ? 60.0 : cat === "CAT C" ? 55.0 : 50.0,
          minCibil: cat === "CAT A" ? 650 : cat === "CAT B" ? 680 : 700,
          roi: cat === "CAT A" ? 10.25 : cat === "CAT B" ? 10.75 : 11.5,
          processingFee: 1.0,
          minLoanAmount: 100000,
          maxLoanAmount: cat === "CAT A" ? 5000000 : 3000000,
          minTenure: 12,
          maxTenure: 84,
          employmentType: "SALARIED",
          notes: `Policy circular revised for H2 FY26. Priority processing for Category ${cat} accounts.`,
        },
      });
    }

    // 2. Loan Products
    const products = [
      { name: "Personal Loan", code: "PL", description: "Unsecured personal loans for salaried individuals", roiRange: "10.25% - 15.0%", maxTenure: 84 },
      { name: "Home Loan", code: "HL", description: "Home buying finance for residential properties", roiRange: "8.40% - 9.50%", maxTenure: 360 },
      { name: "Business Loan", code: "BL", description: "Working capital finance for MSMEs", roiRange: "13.00% - 18.00%", maxTenure: 60 },
    ];

    for (const prod of products) {
      await prisma.loanProduct.create({
        data: {
          bankId: bank.id,
          name: prod.name,
          code: prod.code,
          description: prod.description,
          roiRange: prod.roiRange,
          maxTenure: prod.maxTenure,
        },
      });
    }
  }
  console.log(`✅ Bank policy limits and loan products seeded.`);

  // Seed sample loan leads
  const sampleLeads = [
    { name: "Aditya Verma", mobile: "9876543210", email: "aditya.v@gmail.com", city: "Mumbai", state: "Maharashtra", company: "TATA CONSULTANCY SERVICES LIMITED", monthlyIncome: 65000, loanType: "Personal Loan", loanAmount: 500000, status: "FRESH", source: "WEBSITE" },
    { name: "Pooja Hegde", mobile: "9988776655", email: "pooja.h@yahoo.com", city: "Bengaluru", state: "Karnataka", company: "INFOSYS LIMITED", monthlyIncome: 80000, loanType: "Home Loan", loanAmount: 4500000, status: "ASSIGNED", source: "WEBSITE", assignedExecutiveId: executive.id },
    { name: "Ramesh Kumar", mobile: "9123456789", email: "ramesh.k@rediffmail.com", city: "Delhi", state: "Delhi", company: "RELIANCE INDUSTRIES LIMITED", monthlyIncome: 45000, loanType: "Personal Loan", loanAmount: 200000, status: "CONTACTED", source: "GOOGLE_ADS" },
  ];

  for (const lead of sampleLeads) {
    await prisma.loanApplication.create({
      data: {
        ...lead,
        timeline: [
          { status: "FRESH", timestamp: new Date().toISOString(), note: "Lead automatically captured via portal inquiry form" },
          lead.status !== "FRESH" ? { status: lead.status, timestamp: new Date().toISOString(), note: `Status updated to ${lead.status}` } : null,
        ].filter(Boolean) as any,
      },
    });
  }
  console.log(`✅ CRM Loan Leads seeded.`);
  console.log("🎉 Seed finished successfully!");
}

main()
  .catch((e) => {
    console.error("Error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
