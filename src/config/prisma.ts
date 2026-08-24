import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

declare global {
  var __prisma: PrismaClient | undefined;
}

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

const logOptions: ("query" | "error" | "warn" | "info")[] =
  process.env.NODE_ENV === "development"
    ? ["error", "warn"]
    : ["error"];

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: logOptions,
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

/**
 * On startup: Lightweight connection check (safe, non-destructive).
 */
export async function clearStaleConnections(): Promise<void> {
  try {
    // Non-destructive ping
    await prisma.$queryRawUnsafe(`SELECT 1;`);
  } catch {
    // Non-fatal
  }
}

/**
 * Lightweight Database Connectivity Check for Health / Readiness
 */
export async function checkDatabaseHealth(): Promise<{ isConnected: boolean; latencyMs: number; error?: string }> {
  const start = performance.now();
  try {
    // Run minimal ping query
    await prisma.$queryRawUnsafe(`SELECT 1;`);
    const latencyMs = Math.round(performance.now() - start);
    return { isConnected: true, latencyMs };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    return { isConnected: false, latencyMs, error: "Database connectivity check failed" };
  }
}
