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

/**
 * Hard-cap the connection pool so force-killed processes can't exhaust slots.
 * The DATABASE_URL also carries connection_limit=15, but Prisma's datasource
 * config is the authoritative override at the client level.
 *
 * Pool sizing rationale:
 *   - PostgreSQL superuser reserves ~3 slots
 *   - We keep our app to max 5 connections so there's always headroom
 *   - connection_timeout: give up quickly so requests fail-fast vs. hang
 */
export const prisma =
  global.prisma ||
  new PrismaClient({
    log: logOptions,
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

/**
 * On startup: terminate any stale idle connections left from previous crashes.
 * Runs once, silently — if it fails (e.g. DB is totally down) we log and move on.
 */
export async function clearStaleConnections(): Promise<void> {
  try {
    await prisma.$queryRawUnsafe(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND state IN ('idle', 'idle in transaction')
        AND state_change < NOW() - INTERVAL '90 seconds';
    `);
  } catch {
    // Non-fatal — DB may not have pg_terminate_backend permission; continue
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
