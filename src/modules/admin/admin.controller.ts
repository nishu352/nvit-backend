import { FastifyRequest, FastifyReply } from "fastify";
import {
  getAdminDashboardStats,
  getAllBanks,
  createBank,
  updateBank,
  deleteBank,
  toggleBankStatus,
  toggleBankApply,
  saveBankLogoFile,
  clearBankCompanies,
  clearBankPincodes,
  getAllUsers,
  getAuditLogsList,
  getCompaniesList,
  createCompany,
  updateCompany,
  deleteCompany,
  mergeCompanies,
  bulkUpdateCompanyCategories,
  getPincodesList,
  createPincode,
  updatePincode,
  deletePincode,
  getPoliciesList,
  createPolicy,
  updatePolicy,
  deletePolicy,
  rollbackPolicy,
  getProductsList,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategoryMappings,
  createCategoryMapping,
  updateCategoryMapping,
  deleteCategoryMapping,
  getPolicyHistory,
  getWebsiteCMS,
  updateWebsiteCMS,
  getMarketingSettings,
  updateMarketingSettings,
  getApiKeys,
  createApiKey,
  revokeApiKey,
  getSystemSettings,
  updateSystemSettings,
  getVpsDatabaseAnalytics,
} from "./admin.service.js";

export async function getDashboardStatsHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const stats = await getAdminDashboardStats();
    return reply.send({ success: true, data: stats });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch dashboard stats" });
  }
}

export async function getBanksHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const banks = await getAllBanks();
    return reply.send({ success: true, data: banks });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch banks" });
  }
}

export async function createBankHandler(request: FastifyRequest, reply: FastifyReply) {
  const { name, code, type, logoUrl } = request.body as any;
  if (!name || !code || !type) {
    return reply.status(400).send({ error: true, message: "name, code, and type are required" });
  }

  try {
    const bank = await createBank({ name, code, type, logoUrl });
    return reply.status(201).send({ success: true, data: bank });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to create bank" });
  }
}

export async function updateBankHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as any;

  try {
    const bank = await updateBank(id, body);
    return reply.send({ success: true, data: bank });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to update bank" });
  }
}

export async function deleteBankHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };

  try {
    await deleteBank(id);
    return reply.send({ success: true, message: "Bank deleted successfully" });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to delete bank" });
  }
}

export async function toggleBankStatusHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };

  try {
    const bank = await toggleBankStatus(id);
    return reply.send({ success: true, data: bank });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to toggle status" });
  }
}

export async function toggleBankApplyHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };

  try {
    const bank = await toggleBankApply(id);
    return reply.send({ success: true, data: bank });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to toggle apply status" });
  }
}

export async function uploadBankLogoHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: true, message: "No logo file provided" });
    }

    const buffer = await data.toBuffer();
    if (buffer.length > 5 * 1024 * 1024) {
      return reply.status(400).send({ error: true, message: "File size exceeds 5MB limit" });
    }

    const logoUrl = await saveBankLogoFile(buffer, data.filename);
    return reply.send({ success: true, url: logoUrl });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to upload logo" });
  }
}

export async function clearBankCompaniesHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { cleanOrphans } = (request.query || {}) as { cleanOrphans?: string };
  const shouldCleanOrphans = cleanOrphans === "true" || cleanOrphans === "1";

  try {
    const result = await clearBankCompanies(id, shouldCleanOrphans);
    return reply.send({
      success: true,
      message: `Bank company data cleared successfully. ${result.deletedMappings} mappings removed${shouldCleanOrphans ? ` (${result.deletedOrphans} orphaned companies cleaned)` : ""}.`,
      data: result,
    });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to clear companies" });
  }
}

export async function clearBankPincodesHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  try {
    await clearBankPincodes(id);
    return reply.send({ success: true, message: "Pincode data cleared successfully" });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to clear pincodes" });
  }
}

export async function getUsersHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const users = await getAllUsers();
    return reply.send({ success: true, data: users });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch users" });
  }
}

export async function getAuditLogsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { page, limit } = request.query as { page?: string; limit?: string };
  const pageNum = parseInt(page || "1", 10);
  const limitNum = parseInt(limit || "30", 10);

  try {
    const logs = await getAuditLogsList(pageNum, limitNum);
    return reply.send({ success: true, data: logs });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch audit logs" });
  }
}

// Company Handlers
export async function getCompaniesHandler(request: FastifyRequest, reply: FastifyReply) {
  const { page, limit, query } = request.query as { page?: string; limit?: string; query?: string };
  const pageNum = parseInt(page || "1", 10);
  const limitNum = parseInt(limit || "30", 10);

  try {
    const data = await getCompaniesList(pageNum, limitNum, query);
    return reply.send({ success: true, data });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch companies" });
  }
}

export async function createCompanyHandler(request: FastifyRequest, reply: FastifyReply) {
  const { name, cin } = request.body as { name: string; cin?: string };
  if (!name) return reply.status(400).send({ error: true, message: "name is required" });

  try {
    const company = await createCompany({ name, cin });
    return reply.status(201).send({ success: true, data: company });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to create company" });
  }
}

export async function updateCompanyHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as any;

  try {
    const company = await updateCompany(id, body);
    return reply.send({ success: true, data: company });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to update company" });
  }
}

export async function deleteCompanyHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };

  try {
    await deleteCompany(id);
    return reply.send({ success: true, message: "Company deleted successfully" });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to delete company" });
  }
}

export async function mergeCompaniesHandler(request: FastifyRequest, reply: FastifyReply) {
  const { sourceId, targetId } = request.body as { sourceId: string; targetId: string };
  if (!sourceId || !targetId) {
    return reply.status(400).send({ error: true, message: "sourceId and targetId are required" });
  }

  try {
    await mergeCompanies(sourceId, targetId);
    return reply.send({ success: true, message: "Companies merged successfully" });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to merge companies" });
  }
}

export async function bulkUpdateCompanyCategoriesHandler(request: FastifyRequest, reply: FastifyReply) {
  const { companyIds, bankId, category, status, remarks } = request.body as any;
  if (!companyIds || !bankId || !category || !status) {
    return reply.status(400).send({ error: true, message: "companyIds, bankId, category, and status are required" });
  }

  try {
    await bulkUpdateCompanyCategories(companyIds, bankId, category, status, remarks);
    return reply.send({ success: true, message: "Categories updated successfully" });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed bulk update" });
  }
}

// Pincode Handlers
export async function getPincodesHandler(request: FastifyRequest, reply: FastifyReply) {
  const { page, limit, query } = request.query as { page?: string; limit?: string; query?: string };
  const pageNum = parseInt(page || "1", 10);
  const limitNum = parseInt(limit || "30", 10);

  try {
    const data = await getPincodesList(pageNum, limitNum, query);
    return reply.send({ success: true, data });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch pincodes" });
  }
}

export async function createPincodeHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as any;
  if (!body.pincode || !body.bankId) {
    return reply.status(400).send({ error: true, message: "pincode and bankId are required" });
  }

  try {
    const pin = await createPincode(body);
    return reply.status(201).send({ success: true, data: pin });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to create pincode" });
  }
}

export async function updatePincodeHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as any;

  try {
    const pin = await updatePincode(id, body);
    return reply.send({ success: true, data: pin });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to update pincode" });
  }
}

export async function deletePincodeHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };

  try {
    await deletePincode(id);
    return reply.send({ success: true, message: "Pincode deleted successfully" });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to delete pincode" });
  }
}

// Policy Handlers
export async function getPoliciesHandler(request: FastifyRequest, reply: FastifyReply) {
  const { page, limit, bankId } = request.query as { page?: string; limit?: string; bankId?: string };
  const pageNum = parseInt(page || "1", 10);
  const limitNum = parseInt(limit || "30", 10);

  try {
    const data = await getPoliciesList(pageNum, limitNum, bankId);
    return reply.send({ success: true, data });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch policies" });
  }
}

export async function createPolicyHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as any;
  if (!body.bankId || !body.companyCategory || body.minSalary === undefined) {
    return reply.status(400).send({ error: true, message: "bankId, companyCategory, and minSalary are required" });
  }

  try {
    const policy = await createPolicy(body);
    return reply.status(201).send({ success: true, data: policy });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to create policy" });
  }
}

export async function updatePolicyHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as any;
  const user = request.user as { email?: string } | undefined;

  try {
    const policy = await updatePolicy(id, body, user?.email);
    return reply.send({ success: true, data: policy });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to update policy" });
  }
}

export async function deletePolicyHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };

  try {
    await deletePolicy(id);
    return reply.send({ success: true, message: "Policy deleted successfully" });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to delete policy" });
  }
}

export async function rollbackPolicyHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { historyId } = request.body as { historyId: string };
  if (!historyId) return reply.status(400).send({ error: true, message: "historyId is required" });

  try {
    const policy = await rollbackPolicy(id, historyId);
    return reply.send({ success: true, data: policy });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to rollback policy" });
  }
}

// Product Handlers
export async function getProductsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { bankId } = request.query as { bankId?: string };

  try {
    const products = await getProductsList(bankId);
    return reply.send({ success: true, data: products });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch products" });
  }
}

export async function createProductHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as any;
  if (!body.bankId || !body.name || !body.code) {
    return reply.status(400).send({ error: true, message: "bankId, name, and code are required" });
  }

  try {
    const product = await createProduct(body);
    return reply.status(201).send({ success: true, data: product });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to create product" });
  }
}

export async function updateProductHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as any;

  try {
    const product = await updateProduct(id, body);
    return reply.send({ success: true, data: product });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to update product" });
  }
}

export async function deleteProductHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };

  try {
    await deleteProduct(id);
    return reply.send({ success: true, message: "Product deleted successfully" });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to delete product" });
  }
}

export async function getCategoryMappingsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { page, limit, search } = request.query as { page?: string; limit?: string; search?: string };
  const pageNum = parseInt(page || "1", 10);
  const limitNum = parseInt(limit || "30", 10);

  try {
    const data = await getCategoryMappings(pageNum, limitNum, search);
    return reply.send({ success: true, data });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch mappings" });
  }
}

export async function createCategoryMappingHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as any;
  if (!body.companyId || !body.bankId || !body.category) {
    return reply.status(400).send({ error: true, message: "companyId, bankId, and category are required" });
  }

  try {
    const mapping = await createCategoryMapping(body);
    return reply.status(201).send({ success: true, data: mapping });
  } catch (err: any) {
    return reply.status(450).send({ error: true, message: err.message || "Failed to create mapping" });
  }
}

export async function updateCategoryMappingHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as any;

  try {
    const mapping = await updateCategoryMapping(id, body);
    return reply.send({ success: true, data: mapping });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to update mapping" });
  }
}

export async function deleteCategoryMappingHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };

  try {
    await deleteCategoryMapping(id);
    return reply.send({ success: true, message: "Category mapping deleted successfully" });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to delete mapping" });
  }
}

export async function getPolicyHistoryHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };

  try {
    const history = await getPolicyHistory(id);
    return reply.send({ success: true, data: history });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch policy history" });
  }
}

export async function getWebsiteCMSHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const data = await getWebsiteCMS();
    return reply.send({ success: true, data });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch CMS settings" });
  }
}

export async function updateWebsiteCMSHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as Record<string, any>;
  try {
    const updated = await updateWebsiteCMS(body);
    return reply.send({ success: true, data: updated });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to update CMS settings" });
  }
}

export async function getMarketingSettingsHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const data = await getMarketingSettings();
    return reply.send({ success: true, data });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch marketing settings" });
  }
}

export async function updateMarketingSettingsHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as Record<string, any>;
  try {
    const updated = await updateMarketingSettings(body);
    return reply.send({ success: true, data: updated });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to update marketing settings" });
  }
}

export async function getApiKeysHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const keys = await getApiKeys();
    return reply.send({ success: true, data: keys });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch API keys" });
  }
}

export async function createApiKeyHandler(request: FastifyRequest, reply: FastifyReply) {
  const { name } = request.body as { name: string };
  if (!name) return reply.status(400).send({ error: true, message: "name is required" });

  try {
    const key = await createApiKey(name);
    return reply.status(201).send({ success: true, data: key });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to create API key" });
  }
}

export async function revokeApiKeyHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };

  try {
    const key = await revokeApiKey(id);
    return reply.send({ success: true, data: key });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to revoke API key" });
  }
}

export async function getSystemSettingsHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const settings = await getSystemSettings();
    return reply.send({ success: true, data: settings });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch system settings" });
  }
}

export async function updateSystemSettingsHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as Record<string, any>;
  try {
    const updated = await updateSystemSettings(body);
    return reply.send({ success: true, data: updated });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to update system settings" });
  }
}

export async function getPublishedWebsiteCMSHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { getPublishedWebsiteCMS } = await import("./admin.service.js");
    const data = await getPublishedWebsiteCMS();
    return reply.send({ success: true, data });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch published CMS content" });
  }
}

export async function publishWebsiteCMSHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as { email?: string } | undefined;
  try {
    const { publishWebsiteCMS } = await import("./admin.service.js");
    const data = await publishWebsiteCMS(user?.email);
    return reply.send({ success: true, data });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to publish CMS changes" });
  }
}

export async function getPublicMarketingSettingsHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const data = await getMarketingSettings();

    const adsId = data.googleAds?.adsId || data.google_ads?.conversionId || "";
    const adsLabel = data.googleAds?.label || "";
    const adsEnabled = data.googleAds?.enabled !== undefined ? data.googleAds.enabled : (data.google_ads?.enabled || false);

    const ga4Id = data.analytics?.ga4Id || data.google_analytics?.measurementId || "";
    const gtmId = data.analytics?.gtmId || data.google_tag_manager?.containerId || "";
    const analyticsEnabled = data.analytics?.enabled !== undefined ? data.analytics.enabled : true;

    const pixelId = data.meta?.pixelId || data.meta_pixel?.pixelId || "";
    const metaEnabled = data.meta?.enabled !== undefined ? data.meta.enabled : (data.meta_pixel?.enabled || false);

    const headScript = data.customScripts?.head || "";

    const publicSettings = {
      googleAds: adsEnabled ? { adsId, label: adsLabel } : null,
      analytics: analyticsEnabled ? { ga4Id, gtmId } : null,
      meta: metaEnabled ? { pixelId } : null,
      seo: data.seo || null,
      customScripts: headScript ? { head: headScript } : null,
    };

    return reply.send({ success: true, data: publicSettings });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch public marketing config" });
  }
}

export async function rollbackWebsiteCMSHandler(request: FastifyRequest, reply: FastifyReply) {
  const { version } = request.body as { version: number };
  const user = request.user as { email?: string } | undefined;
  try {
    const { rollbackWebsiteCMS } = await import("./admin.service.js");
    const data = await rollbackWebsiteCMS(version, user?.email);
    return reply.send({ success: true, data });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to rollback CMS content" });
  }
}

export async function getVpsDatabaseAnalyticsHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const analytics = await getVpsDatabaseAnalytics();
    return reply.send({ success: true, data: analytics });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch database analytics" });
  }
}
