import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

declare global {
  var prisma: PrismaClient | undefined;
}

// Conservative logging: never log raw connection strings or secrets
const logOptions: ("query" | "error" | "warn" | "info")[] =
  process.env.NODE_ENV === "development"
    ? ["error", "warn"]
    : ["error"];

export const prisma =
  global.prisma ||
  new PrismaClient({
    log: logOptions,
  });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
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
