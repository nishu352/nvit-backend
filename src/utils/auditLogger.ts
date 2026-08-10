import { prisma } from "../config/prisma.js";

interface AuditLogOptions {
  userId?: string;
  userEmail?: string;
  action: string;
  entity: string;
  entityId?: string;
  details?: Record<string, any> | string;
  ipAddress?: string;
}

export async function createAuditLog(options: AuditLogOptions) {
  try {
    const detailsStr = typeof options.details === "object" ? JSON.stringify(options.details) : options.details;
    await prisma.auditLog.create({
      data: {
        userId: options.userId || null,
        userEmail: options.userEmail || null,
        action: options.action,
        entity: options.entity,
        entityId: options.entityId || null,
        details: detailsStr || null,
        ipAddress: options.ipAddress || null,
      },
    });
  } catch (err) {
    console.error("Failed to create audit log:", err);
  }
}
