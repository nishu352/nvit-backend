import { FastifyRequest, FastifyReply } from "fastify";
import {
  processBankExcelImport,
  analyzeUploadedFile,
  startConfirmedImport,
  getImportHistoryList,
  getImportStatus,
  getImportErrors,
  ConfirmedMapping,
  forceSyncErrors,
} from "./import.service.js";

// ─── LEGACY: Single-shot upload (backward compat) ─────────────────────────────

export async function uploadExcelHandler(request: FastifyRequest, reply: FastifyReply) {
  const data = await request.file();
  if (!data) {
    return reply.status(400).send({ error: true, message: "No file uploaded" });
  }

  const fields = data.fields as Record<string, any>;
  const bankId = fields.bankId?.value;
  const importType = fields.importType?.value || "MERGE";

  if (!bankId) {
    return reply.status(400).send({ error: true, message: "bankId is required" });
  }

  try {
    const buffer = await data.toBuffer();
    const authUser = request.user as { id: string };

    const result = await processBankExcelImport(
      bankId,
      buffer,
      data.filename,
      importType as "REPLACE" | "MERGE",
      authUser.id
    );

    return reply.status(200).send({
      success: true,
      message: `File processed successfully. ${result.processedRecords} records imported.`,
      data: result,
    });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Excel import failed" });
  }
}

// ─── Phase 1: Analyze ─────────────────────────────────────────────────────────

export async function analyzeHandler(request: FastifyRequest, reply: FastifyReply) {
  let data: Awaited<ReturnType<typeof request.file>> | undefined;

  try {
    data = await request.file();
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: "Failed to parse multipart request: " + err.message });
  }

  if (!data) {
    return reply.status(400).send({ error: true, message: "No file was uploaded." });
  }

  // Validate filename
  const fileName = (data.filename || "unknown").replace(/[^a-zA-Z0-9._\-() ]/g, "_");
  const ext = fileName.split(".").pop()?.toLowerCase();

  if (!ext || !["xlsx", "xls", "csv"].includes(ext)) {
    return reply.status(400).send({
      error: true,
      message: `File type ".${ext}" is not supported. Please upload .xlsx, .xls, or .csv files only.`,
    });
  }

  // Reject files based on MIME type (defense in depth — don't trust this alone)
  const allowedMimes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "application/csv",
    "application/octet-stream", // Some clients report this for xlsx
    "multipart/form-data",
  ];

  let buffer: Buffer;
  try {
    buffer = await data.toBuffer();
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: "Failed to read uploaded file." });
  }

  if (buffer.length === 0) {
    return reply.status(400).send({ error: true, message: "Uploaded file is empty." });
  }

  if (buffer.length > 50 * 1024 * 1024) {
    return reply.status(400).send({ error: true, message: "File exceeds the 50MB size limit." });
  }

  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const queryEntityType = url.searchParams.get("entityType");
    
    const entityTypeField = data.fields?.entityType as any;
    const entityType = (queryEntityType || entityTypeField?.value || (request.query as any)?.entityType || "COMPANY").toUpperCase();
    console.log("DEBUG: analyzeHandler resolved entityType =", entityType);
    
    const result = await analyzeUploadedFile(buffer, fileName, buffer.length, entityType);
    console.log("DEBUG: analyzeResult mapped pincode =", result.aiMapping.mapping.pincode, "valid:", result.validRows, "invalid:", result.invalidRows);

    return reply.status(200).send({
      success: true,
      data: result,
    });
  } catch (err: any) {
    // Return human-readable error (never raw stack trace)
    const userMessage = err.message || "File analysis failed. Please check the file format and try again.";
    return reply.status(400).send({ error: true, message: userMessage });
  }
}

// ─── Phase 2: Confirm Import ──────────────────────────────────────────────────

export async function confirmHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as {
    sessionId?: string;
    bankId?: string;
    importType?: string;
    entityType?: string;
    confirmedMapping?: ConfirmedMapping;
  };

  const { sessionId, bankId, importType, entityType, confirmedMapping } = body;

  if (!sessionId) return reply.status(400).send({ error: true, message: "sessionId is required." });
  if (!bankId) return reply.status(400).send({ error: true, message: "bankId is required." });
  const resolvedEntity = (entityType || "COMPANY").toUpperCase();

  if (!confirmedMapping) {
    return reply.status(400).send({
      error: true,
      message: "Missing confirmedMapping object.",
    });
  }

  if (resolvedEntity === "COMPANY" && !confirmedMapping.company_name) {
    return reply.status(400).send({
      error: true,
      message: "A column must be mapped to Company Name before importing.",
    });
  }
  
  if (resolvedEntity === "PINCODE" && !confirmedMapping.pincode) {
    return reply.status(400).send({
      error: true,
      message: "A column must be mapped to Pincode before importing.",
    });
  }

  const validImportTypes = ["REPLACE", "MERGE"];
  const resolvedImportType = (importType || "MERGE").toUpperCase();
  if (!validImportTypes.includes(resolvedImportType)) {
    return reply.status(400).send({ error: true, message: "importType must be REPLACE or MERGE." });
  }

  const authUser = request.user as { id: string };

  try {
    const { historyId, totalRecords } = await startConfirmedImport(
      sessionId,
      bankId,
      resolvedImportType as "REPLACE" | "MERGE",
      resolvedEntity as "COMPANY" | "PINCODE",
      confirmedMapping,
      authUser.id
    );

    return reply.status(200).send({
      success: true,
      message: `Import started. Processing ${totalRecords.toLocaleString()} rows in the background.`,
      data: { historyId, totalRecords },
    });
  } catch (err: any) {
    return reply.status(err.message.includes("not found") ? 404 : 500).send({
      error: true,
      message: err.message || "Failed to start import.",
    });
  }
}

// ─── Status Polling ───────────────────────────────────────────────────────────

export async function importStatusHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { historyId } = request.params as { historyId: string };

  try {
    const status = await getImportStatus(historyId);
    return reply.send({ success: true, data: status });
  } catch (err: any) {
    return reply.status(404).send({ error: true, message: err.message });
  }
}

// ─── History ──────────────────────────────────────────────────────────────────

export async function getImportHistoryHandler(request: FastifyRequest, reply: FastifyReply) {
  const { page, limit } = request.query as { page?: string; limit?: string };
  const pageNum = parseInt(page || "1", 10);
  const limitNum = parseInt(limit || "20", 10);

  try {
    const data = await getImportHistoryList(pageNum, limitNum);
    return reply.send({ success: true, data });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch import history" });
  }
}

// ─── Row-Level Import Errors ───────────────────────────────────────────────────

export async function getImportErrorsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { historyId } = request.params as { historyId: string };
  const { page, limit, errorCode } = request.query as {
    page?: string;
    limit?: string;
    errorCode?: string;
  };

  const pageNum = Math.max(1, parseInt(page || "1", 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit || "50", 10)));

  try {
    const data = await getImportErrors(historyId, pageNum, limitNum, errorCode);
    return reply.send({ success: true, data });
  } catch (err: any) {
    return reply.status(500).send({
      error: true,
      message: "Failed to fetch import errors", // Never expose raw stack trace
    });
  }
}

// ─── Force Sync Failed Records ────────────────────────────────────────────────

export async function forceSyncHandler(request: FastifyRequest, reply: FastifyReply) {
  const { historyId } = request.params as { historyId: string };
  const { errorIds, forceSyncAll, filterCode } = request.body as { errorIds?: string[]; forceSyncAll?: boolean; filterCode?: string };

  if (!forceSyncAll && (!errorIds || !Array.isArray(errorIds) || errorIds.length === 0)) {
    return reply.status(400).send({ error: true, message: "Please provide an array of errorIds to force sync, or set forceSyncAll." });
  }

  const authUser = request.user as { id: string };

  try {
    const result = await forceSyncErrors(historyId, errorIds || [], authUser.id, forceSyncAll, filterCode);
    return reply.send({ success: true, data: result });
  } catch (err: any) {
    return reply.status(500).send({
      error: true,
      message: err.message || "Failed to force sync records.",
    });
  }
}
