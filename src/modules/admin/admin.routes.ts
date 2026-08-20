import { FastifyInstance } from "fastify";
import {
  getDashboardStatsHandler,
  getBanksHandler,
  createBankHandler,
  updateBankHandler,
  deleteBankHandler,
  toggleBankStatusHandler,
  toggleBankApplyHandler,
  uploadBankLogoHandler,
  clearBankCompaniesHandler,
  clearBankPincodesHandler,
  getUsersHandler,
  getAuditLogsHandler,
  getCompaniesHandler,
  createCompanyHandler,
  updateCompanyHandler,
  deleteCompanyHandler,
  mergeCompaniesHandler,
  bulkUpdateCompanyCategoriesHandler,
  getPincodesHandler,
  createPincodeHandler,
  updatePincodeHandler,
  deletePincodeHandler,
  getPoliciesHandler,
  createPolicyHandler,
  updatePolicyHandler,
  deletePolicyHandler,
  rollbackPolicyHandler,
  getPolicyHistoryHandler,
  getProductsHandler,
  createProductHandler,
  updateProductHandler,
  deleteProductHandler,
  getCategoryMappingsHandler,
  createCategoryMappingHandler,
  updateCategoryMappingHandler,
  deleteCategoryMappingHandler,
  getWebsiteCMSHandler,
  updateWebsiteCMSHandler,
  getPublishedWebsiteCMSHandler,
  publishWebsiteCMSHandler,
  rollbackWebsiteCMSHandler,
  getMarketingSettingsHandler,
  updateMarketingSettingsHandler,
  getPublicMarketingSettingsHandler,
  getApiKeysHandler,
  createApiKeyHandler,
  revokeApiKeyHandler,
  getSystemSettingsHandler,
  updateSystemSettingsHandler,
  getVpsDatabaseAnalyticsHandler,
} from "./admin.controller.js";
import {
  scanDatabaseHandler,
  cleanDatabaseHandler,
} from "./maintenance.controller.js";
import { authenticate, authorizeRoles } from "../../middleware/auth.js";

export async function adminRoutes(app: FastifyInstance) {
  const readAllHandlers = { preHandler: [authenticate, authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "EXECUTIVE", "VIEWER")] };
  const writeOpsHandlers = { preHandler: [authenticate, authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER")] };
  const superOrAdminHandlers = { preHandler: [authenticate, authorizeRoles("SUPER_ADMIN", "ADMIN")] };

  // Public CMS & Marketing configurations (no authentication preHandler)
  app.get("/api/v1/cms/published", getPublishedWebsiteCMSHandler);
  app.get("/api/v1/marketing/public", getPublicMarketingSettingsHandler);

  // Dashboard Stats & VPS Analytics
  app.get("/api/v1/admin/dashboard/stats", readAllHandlers, getDashboardStatsHandler);
  app.get("/api/v1/admin/analytics/vps-db", readAllHandlers, getVpsDatabaseAnalyticsHandler);

  // Banks & NBFCs
  app.get("/api/v1/admin/banks", readAllHandlers, getBanksHandler);
  app.post("/api/v1/admin/banks", writeOpsHandlers, createBankHandler);
  app.put("/api/v1/admin/banks/:id", writeOpsHandlers, updateBankHandler);
  app.delete("/api/v1/admin/banks/:id", writeOpsHandlers, deleteBankHandler);
  app.patch("/api/v1/admin/banks/:id/toggle", writeOpsHandlers, toggleBankStatusHandler);
  app.patch("/api/v1/admin/banks/:id/toggle-apply", writeOpsHandlers, toggleBankApplyHandler);
  app.post("/api/v1/admin/banks/upload-logo", writeOpsHandlers, uploadBankLogoHandler);
  app.delete("/api/v1/admin/banks/:id/data/companies", writeOpsHandlers, clearBankCompaniesHandler);
  app.delete("/api/v1/admin/banks/:id/data/pincodes", writeOpsHandlers, clearBankPincodesHandler);

  // Users Management & Audit Logs
  app.get("/api/v1/admin/users", superOrAdminHandlers, getUsersHandler);
  app.get("/api/v1/admin/audit-logs", superOrAdminHandlers, getAuditLogsHandler);

  // Companies Management
  app.get("/api/v1/admin/companies", readAllHandlers, getCompaniesHandler);
  app.post("/api/v1/admin/companies", writeOpsHandlers, createCompanyHandler);
  app.put("/api/v1/admin/companies/:id", writeOpsHandlers, updateCompanyHandler);
  app.delete("/api/v1/admin/companies/:id", writeOpsHandlers, deleteCompanyHandler);
  app.post("/api/v1/admin/companies/merge", writeOpsHandlers, mergeCompaniesHandler);
  app.post("/api/v1/admin/companies/bulk-category", writeOpsHandlers, bulkUpdateCompanyCategoriesHandler);

  // Company Categories Mapping CRUD
  app.get("/api/v1/admin/categories", readAllHandlers, getCategoryMappingsHandler);
  app.post("/api/v1/admin/categories", writeOpsHandlers, createCategoryMappingHandler);
  app.put("/api/v1/admin/categories/:id", writeOpsHandlers, updateCategoryMappingHandler);
  app.delete("/api/v1/admin/categories/:id", writeOpsHandlers, deleteCategoryMappingHandler);

  // Pincode Management
  app.get("/api/v1/admin/pincodes", readAllHandlers, getPincodesHandler);
  app.post("/api/v1/admin/pincodes", writeOpsHandlers, createPincodeHandler);
  app.put("/api/v1/admin/pincodes/:id", writeOpsHandlers, updatePincodeHandler);
  app.delete("/api/v1/admin/pincodes/:id", writeOpsHandlers, deletePincodeHandler);

  // Policy Management
  app.get("/api/v1/admin/policies", readAllHandlers, getPoliciesHandler);
  app.post("/api/v1/admin/policies", writeOpsHandlers, createPolicyHandler);
  app.put("/api/v1/admin/policies/:id", writeOpsHandlers, updatePolicyHandler);
  app.delete("/api/v1/admin/policies/:id", writeOpsHandlers, deletePolicyHandler);
  app.post("/api/v1/admin/policies/:id/rollback", writeOpsHandlers, rollbackPolicyHandler);
  app.get("/api/v1/admin/policies/:id/history", readAllHandlers, getPolicyHistoryHandler);

  // Loan Products Management
  app.get("/api/v1/admin/products", readAllHandlers, getProductsHandler);
  app.post("/api/v1/admin/products", writeOpsHandlers, createProductHandler);
  app.put("/api/v1/admin/products/:id", writeOpsHandlers, updateProductHandler);
  app.delete("/api/v1/admin/products/:id", writeOpsHandlers, deleteProductHandler);

  // CMS Editor
  app.get("/api/v1/admin/cms", readAllHandlers, getWebsiteCMSHandler);
  app.put("/api/v1/admin/cms", superOrAdminHandlers, updateWebsiteCMSHandler);
  app.post("/api/v1/admin/cms/publish", superOrAdminHandlers, publishWebsiteCMSHandler);
  app.post("/api/v1/admin/cms/rollback", superOrAdminHandlers, rollbackWebsiteCMSHandler);

  // Marketing & Tracking Configuration
  app.get("/api/v1/admin/marketing", superOrAdminHandlers, getMarketingSettingsHandler);
  app.put("/api/v1/admin/marketing", superOrAdminHandlers, updateMarketingSettingsHandler);

  // API Keys & Security
  app.get("/api/v1/admin/security/apikeys", superOrAdminHandlers, getApiKeysHandler);
  app.post("/api/v1/admin/security/apikeys", superOrAdminHandlers, createApiKeyHandler);
  app.patch("/api/v1/admin/security/apikeys/:id/revoke", superOrAdminHandlers, revokeApiKeyHandler);

  // System Configuration
  app.get("/api/v1/admin/system", superOrAdminHandlers, getSystemSettingsHandler);
  app.put("/api/v1/admin/system", superOrAdminHandlers, updateSystemSettingsHandler);

  // Database Maintenance & Safe Sanitizer
  app.get("/api/v1/admin/maintenance/scan", superOrAdminHandlers, scanDatabaseHandler);
  app.post("/api/v1/admin/maintenance/clean", superOrAdminHandlers, cleanDatabaseHandler);
}
