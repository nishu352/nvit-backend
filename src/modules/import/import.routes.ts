import { FastifyInstance } from "fastify";
import {
  uploadExcelHandler,
  analyzeHandler,
  confirmHandler,
  importStatusHandler,
  getImportHistoryHandler,
  getImportErrorsHandler,
  forceSyncHandler,
  abortImportHandler,
} from "./import.controller.js";
import { authenticate, authorizeRoles } from "../../middleware/auth.js";

const IMPORT_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"] as const;

export async function importRoutes(app: FastifyInstance) {
  // ── Phase 1: Analyze file (AI schema detection) ──────────────────────────
  // Accepts multipart/form-data with file + bankId + entityType fields
  app.post(
    "/api/v1/import/analyze",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    analyzeHandler
  );
  app.post(
    "/api/v1/admin/import/analyze",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    analyzeHandler
  );
  app.post(
    "/api/v1/admin/pincodes/import/analyze",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    analyzeHandler
  );

  // ── Phase 2: Confirm import (triggers background DB write) ───────────────
  // Accepts JSON body: { sessionId, bankId, importType, entityType, confirmedMapping }
  app.post(
    "/api/v1/import/confirm",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    confirmHandler
  );
  app.post(
    "/api/v1/admin/import/confirm",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    confirmHandler
  );
  app.post(
    "/api/v1/admin/import/execute",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    confirmHandler
  );
  app.post(
    "/api/v1/admin/pincodes/import/confirm",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    confirmHandler
  );
  app.post(
    "/api/v1/admin/pincodes/import/execute",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    confirmHandler
  );

  // ── Status polling endpoint ───────────────────────────────────────────────
  app.get(
    "/api/v1/import/status/:historyId",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    importStatusHandler
  );
  app.get(
    "/api/v1/admin/import/status/:historyId",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    importStatusHandler
  );
  app.get(
    "/api/v1/admin/pincodes/import/status/:historyId",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    importStatusHandler
  );

  // ── Import history ────────────────────────────────────────────────────────
  app.get(
    "/api/v1/import/history",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    getImportHistoryHandler
  );
  app.get(
    "/api/v1/admin/import/history",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    getImportHistoryHandler
  );
  app.get(
    "/api/v1/admin/import-history",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    getImportHistoryHandler
  );

  // GET /import/:historyId/errors?page=1&limit=50&errorCode=DUPLICATE
  app.get(
    "/api/v1/import/:historyId/errors",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    getImportErrorsHandler
  );
  app.get(
    "/api/v1/admin/import/:historyId/errors",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    getImportErrorsHandler
  );

  // ── Force Sync Failed/Skipped Records ───────────────────────────────────────
  app.post(
    "/api/v1/import/:historyId/force-sync",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    forceSyncHandler
  );

  // ── Abort Import ────────────────────────────────────────────────────────────
  app.post(
    "/api/v1/import/:historyId/abort",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    abortImportHandler
  );

  // ── Legacy single-shot upload (backward compatibility) ────────────────────
  app.post(
    "/api/v1/import/upload",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    uploadExcelHandler
  );
}
