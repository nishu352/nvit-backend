import { FastifyRequest, FastifyReply } from "fastify";
import {
  scanDatabase,
  cleanDatabase,
  CleanDatabaseOptions,
} from "./maintenance.service.js";

export async function scanDatabaseHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const data = await scanDatabase();
    return reply.send({ success: true, data });
  } catch (err: any) {
    request.log.error(err, "Failed to scan database for maintenance");
    return reply.status(500).send({
      error: true,
      message: err.message || "Failed to scan database",
    });
  }
}

export async function cleanDatabaseHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as { id?: string; email?: string } | undefined;
  const body = request.body as CleanDatabaseOptions;

  if (!body || !body.confirmationText) {
    return reply.status(400).send({
      error: true,
      message: "confirmationText is required and must be 'CLEAN DATABASE'",
    });
  }

  try {
    const result = await cleanDatabase(body, user);
    return reply.send({ success: true, data: result });
  } catch (err: any) {
    request.log.error(err, "Failed to execute database cleanup");
    return reply.status(400).send({
      error: true,
      message: err.message || "Database cleanup failed",
    });
  }
}
