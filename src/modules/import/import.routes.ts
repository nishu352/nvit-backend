import { FastifyInstance } from "fastify";
import {
  uploadExcelHandler,
  analyzeHandler,
  confirmHandler,
  importStatusHandler,
  getImportHistoryHandler,
  getImportErrorsHandler,
  forceSyncHandler,
} from "./import.controller.js";
import { authenticate, authorizeRoles } from "../../middleware/auth.js";

const IMPORT_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"] as const;

export async function importRoutes(app: FastifyInstance) {
  // ── Phase 1: Analyze file (AI schema detection) ──────────────────────────
  // Accepts multipart/form-data with file + bankId fields
  app.post(
    "/api/v1/import/analyze",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    analyzeHandler
  );

  // ── Phase 2: Confirm import (triggers background DB write) ───────────────
  // Accepts JSON body: { sessionId, bankId, importType, confirmedMapping }
  app.post(
    "/api/v1/import/confirm",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    confirmHandler
  );

  // ── Status polling endpoint ───────────────────────────────────────────────
  // Accepts GET /import/status/:historyId
  app.get(
    "/api/v1/import/status/:historyId",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    importStatusHandler
  );

  // ── Import history ────────────────────────────────────────────────────────
  app.get(
    "/api/v1/import/history",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    getImportHistoryHandler
  );

  // GET /import/:historyId/errors?page=1&limit=50&errorCode=DUPLICATE
  app.get(
    "/api/v1/import/:historyId/errors",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    getImportErrorsHandler
  );

  // ── Force Sync Failed/Skipped Records ───────────────────────────────────────
  app.post(
    "/api/v1/import/:historyId/force-sync",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    forceSyncHandler
  );

  // ── Legacy single-shot upload (backward compatibility) ────────────────────
  app.post(
    "/api/v1/import/upload",
    { preHandler: [authenticate, authorizeRoles(...IMPORT_ROLES)] },
    uploadExcelHandler
  );
}
