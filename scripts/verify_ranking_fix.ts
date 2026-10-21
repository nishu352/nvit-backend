import { searchCompanies, getCompanyAutocomplete } from "../src/modules/company/company.service.js";

interface TestCase {
  query: string;
  expectedTopMatchName?: string;
  expectedTopScore?: number;
  expectedTopMatchType?: string;
  companyId?: string;
  description: string;
}

const testCases: TestCase[] = [
  {
    query: "NIF PRIVATE LIMITED",
    expectedTopMatchName: "NIF PRIVATE LIMITED",
    expectedTopScore: 100,
    expectedTopMatchType: "EXACT_MATCH",
    description: "Exact normalized-name match for NIF PRIVATE LIMITED",
  },
  {
    query: "NIF PRIVATE",
    expectedTopMatchName: "NIF PRIVATE LIMITED",
    expectedTopScore: 99,
    expectedTopMatchType: "EXACT_MATCH",
    description: "Exact base-name match for NIF PRIVATE",
  },
  {
    query: "NIF FINANCIERS LIMITED",
    expectedTopMatchName: "NIF FINANCIERS LIMITED",
    expectedTopScore: 100,
    expectedTopMatchType: "EXACT_MATCH",
    description: "Exact normalized-name match for NIF FINANCIERS LIMITED",
  },
  {
    query: "TATA CONSULTANCY SERVICES LIMITED",
    expectedTopMatchName: "TATA CONSULTANCY SERVICES LIMITED",
    expectedTopScore: 100,
    expectedTopMatchType: "EXACT_MATCH",
    description: "Exact match for TATA CONSULTANCY SERVICES LIMITED",
  },
  {
    query: "SERVICES CONSULTANCY TATA",
    expectedTopMatchName: "TATA CONSULTANCY SERVICES LIMITED",
    description: "Reversed multi-token query should match TATA CONSULTANCY SERVICES LIMITED via ALL_TOKENS_MATCH",
  },
  {
    query: "NIFTY50 NOTREALCOMPANYXYZ",
    description: "Non-existent company query should gracefully return empty results",
  },
  {
    query: "NIF",
    expectedTopMatchName: "NIF PRIVATE LIMITED",
    expectedTopScore: 99,
    description: "Prefix query NIF matching baseName NIF",
  },
  {
    query: "NIF PRIVATE LIMITED",
    companyId: "e1185da9-6254-4ef0-88dc-f59e9a1302f8", // NIF PRIVATE LIMITED id
    expectedTopMatchName: "NIF PRIVATE LIMITED",
    expectedTopScore: 100,
    expectedTopMatchType: "EXACT_MATCH",
    description: "Autocomplete selected companyId preserved in final search",
  },
];

async function run() {
  console.log("==================================================================");
  console.log("        NVIT.SPACE — COMPANY SEARCH RANKING BUG VERIFICATION      ");
  console.log("==================================================================\n");

  let allPassed = true;

  for (const tc of testCases) {
    console.log(`\nTEST: ${tc.description}`);
    console.log(`Query: "${tc.query}"${tc.companyId ? ` (companyId: ${tc.companyId})` : ""}`);

    // Test Autocomplete (without companyId, as autocomplete is typing)
    const autoResults = await getCompanyAutocomplete(tc.query);
    console.log(`  Autocomplete (${autoResults.length} suggestions):`);
    autoResults.slice(0, 3).forEach((item, idx) => {
      console.log(`    ${idx + 1}. [${item.id}] "${item.name}" (score: ${item.relevanceScore}, ${item.matchType})`);
    });

    // Test Search
    const searchResults = await searchCompanies(tc.query, tc.companyId ? { companyId: tc.companyId } : {});
    console.log(`  Search (${searchResults.length} results):`);
    searchResults.slice(0, 3).forEach((item, idx) => {
      console.log(`    ${idx + 1}. [${item.companyId}] "${item.companyName}" (score: ${item.relevanceScore}, ${item.matchType})`);
      if (idx === 0) {
        console.log(`       Bank Categories count: ${item.banks ? item.banks.length : 0}`);
        if (item.banks && item.banks.length > 0) {
          console.log(`       Sample bank: ${item.banks[0].bankName} -> Category: ${item.banks[0].category}`);
        }
      }
    });

    // Validations
    if (tc.expectedTopMatchName) {
      if (searchResults.length === 0) {
        console.error(`  ❌ FAILED: Expected search results, got 0`);
        allPassed = false;
        continue;
      }
      const topSearch = searchResults[0];
      const matchName = topSearch.companyName.toUpperCase();
      if (matchName !== tc.expectedTopMatchName.toUpperCase()) {
        console.error(`  ❌ FAILED: Search top match was "${topSearch.companyName}", expected "${tc.expectedTopMatchName}"`);
        allPassed = false;
      } else {
        console.log(`  ✅ PASSED: Top match is "${topSearch.companyName}"`);
      }

      if (tc.expectedTopScore !== undefined && topSearch.relevanceScore !== tc.expectedTopScore) {
        console.error(`  ❌ FAILED: Expected score ${tc.expectedTopScore}, got ${topSearch.relevanceScore}`);
        allPassed = false;
      } else if (tc.expectedTopScore !== undefined) {
        console.log(`  ✅ PASSED: Top match score ${topSearch.relevanceScore} matches expected ${tc.expectedTopScore}`);
      }

      // Check consistency with autocomplete when query is exact
      if (autoResults.length > 0 && !tc.companyId && tc.expectedTopScore === 100) {
        const topAuto = autoResults[0];
        if (topAuto.name.toUpperCase() !== topSearch.companyName.toUpperCase()) {
          console.error(`  ❌ FAILED: Autocomplete top [${topAuto.name}] != Search top [${topSearch.companyName}]`);
          allPassed = false;
        } else {
          console.log(`  ✅ PASSED: Autocomplete and Search #1 are consistent ("${topAuto.name}")`);
        }
      }
    } else {
      // Empty query test
      if (searchResults.length === 0) {
        console.log(`  ✅ PASSED: Correctly returned 0 results for non-existent company`);
      } else {
        console.error(`  ❌ FAILED: Expected 0 results, got ${searchResults.length}`);
        allPassed = false;
      }
    }
  }

  console.log("\n==================================================================");
  if (allPassed) {
    console.log("  ALL REGRESSION TESTS PASSED SUCCESSFULLY!  ");
  } else {
    console.error("  SOME REGRESSION TESTS FAILED!  ");
  }
  console.log("==================================================================\n");

  process.exit(allPassed ? 0 : 1);
}

run().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(1);
});
