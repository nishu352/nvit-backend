import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import dotenv from "dotenv";

import { prisma, checkDatabaseHealth } from "./config/prisma.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { companyRoutes } from "./modules/company/company.routes.js";
import { pincodeRoutes } from "./modules/pincode/pincode.routes.js";
import { loanRoutes } from "./modules/loan/loan.routes.js";
import { importRoutes } from "./modules/import/import.routes.js";
import { adminRoutes } from "./modules/admin/admin.routes.js";

dotenv.config();

const PORT = parseInt(process.env.PORT || "5001", 10);
const HOST = "0.0.0.0";
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-enterprise-jwt-key-2026-fintech-platform";

export async function buildApp() {
  // ── Cached DB health (updated in background every 45s) ───────────────────────
  // This prevents /health from timing out when backend is busy with a file import
  let cachedDbStatus = { isConnected: true, latencyMs: 0 };
  async function refreshDbHealth() {
    try { cachedDbStatus = await checkDatabaseHealth(); } catch { /* keep last known */ }
  }
  refreshDbHealth(); // Initial check
  setInterval(refreshDbHealth, 45_000); // Refresh every 45s in background

  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "info" : "debug",
    },
  });

  // Security Plugins
  await app.register(helmet, {
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      const allowedOrigins = process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
        : [];

      if (!origin || process.env.NODE_ENV !== "production" || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        cb(null, true);
        return;
      }

      try {
        const hostname = new URL(origin).hostname;
        if (
          hostname === "localhost" ||
          hostname === "127.0.0.1" ||
          hostname === "nvit.space" ||
          hostname.endsWith(".nvit.space") ||
          hostname.endsWith(".vercel.app")
        ) {
          cb(null, true);
          return;
        }
      } catch (_) {}

      cb(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
  });

  await app.register(jwt, {
    secret: JWT_SECRET,
  });

  await app.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB max file size for master datasets
    },
  });

  // Register Feature API Routes
  await app.register(authRoutes);
  await app.register(companyRoutes);
  await app.register(pincodeRoutes);
  await app.register(loanRoutes);
  await app.register(importRoutes);
  await app.register(adminRoutes);

  // ── Database Health & Readiness Endpoints ─────────────────────────────────

  // Standard GET /api/health endpoint
  app.get("/api/health", async (request, reply) => {
    const dbHealth = await checkDatabaseHealth();
    const isHealthy = dbHealth.isConnected;
    const statusCode = isHealthy ? 200 : 503;

    return reply.status(statusCode).send({
      status: isHealthy ? "healthy" : "degraded",
      api: "online",
      database: {
        status: isHealthy ? "connected" : "disconnected",
        engine: "PostgreSQL 16",
        latencyMs: dbHealth.latencyMs,
      },
      uptime: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
    });
  });

  // Standard GET /health endpoint — instant response using cached DB status
  app.get("/health", async (request, reply) => {
    return reply.status(200).send({
      status: "ok",
      database: cachedDbStatus.isConnected ? "connected" : "degraded",
      latencyMs: cachedDbStatus.latencyMs,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // GET /api/v1/health endpoint
  app.get("/api/v1/health", async (request, reply) => {
    const dbHealth = await checkDatabaseHealth();
    const isHealthy = dbHealth.isConnected;
    const statusCode = isHealthy ? 200 : 503;

    return reply.status(statusCode).send({
      status: isHealthy ? "ok" : "degraded",
      service: "FinVerify REST API Gateway",
      version: "1.0.0",
      database: {
        status: isHealthy ? "connected" : "disconnected",
        latencyMs: dbHealth.latencyMs,
      },
      uptime: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
    });
  });

  // GET /api/ready (Kubernetes / Railway readiness probe)
  app.get("/api/ready", async (request, reply) => {
    const dbHealth = await checkDatabaseHealth();
    if (!dbHealth.isConnected) {
      return reply.status(503).send({ ready: false, error: "Database not ready" });
    }
    return reply.send({ ready: true, latencyMs: dbHealth.latencyMs });
  });

  // Root endpoint
  app.get("/", async () => {
    return {
      status: "ok",
      service: "FinVerify Enterprise API Gateway",
      version: "1.0.0",
      health: "/api/health",
      timestamp: new Date().toISOString(),
    };
  });

  // Global Error Handler — ensures zero credential leaks
  app.setErrorHandler((error: any, request, reply) => {
    app.log.error(error);
    const statusCode = error.statusCode || 500;
    
    // Sanitize message: never leak database URLs, connection strings, or system paths
    let safeMessage = error.message || "Internal Server Error";
    if (safeMessage.includes("postgresql://") || safeMessage.includes("password")) {
      safeMessage = "Database operation error";
    }

    reply.status(statusCode).send({
      error: true,
      statusCode,
      message: safeMessage,
    });
  });

  // Graceful Shutdown Hook for Prisma
  app.addHook("onClose", async () => {
    app.log.info("Closing Prisma connection cleanly...");
    await prisma.$disconnect();
  });

  return app;
}

if (process.env.NODE_ENV !== "test") {
  buildApp()
    .then((app) => {
      // Register OS signal handlers for graceful exit
      const handleShutdown = async (signal: string) => {
        app.log.info(`Received ${signal}. Gracefully stopping server...`);
        try {
          await app.close();
          await prisma.$disconnect();
          app.log.info("Server and Prisma shutdown complete.");
          process.exit(0);
        } catch (err) {
          app.log.error(err);
          process.exit(1);
        }
      };

      process.on("SIGINT", () => handleShutdown("SIGINT"));
      process.on("SIGTERM", () => handleShutdown("SIGTERM"));

      app.listen({ port: PORT, host: HOST }, (err, address) => {
        if (err) {
          app.log.error(err);
          process.exit(1);
        }
        app.log.info(`🚀 Enterprise Backend REST Server listening on ${address}`);

        // Startup background cleanup: resolve any imports marked as PROCESSING before crash/restart
        prisma.importHistory.updateMany({
          where: { status: "PROCESSING" },
          data: {
            status: "FAILED",
            errorMessage: "Import interrupted — server restarted during processing. Please re-upload the file.",
          },
        })
        .then((stuck) => {
          if (stuck && stuck.count > 0) {
            console.warn(`⚠️  Resolved ${stuck.count} stuck import(s) — marked as FAILED on startup`);
          }
        })
        .catch((e) => {
          console.warn("Startup import cleanup skipped:", e?.message || e);
        });
      });
    })
    .catch((err) => {
      console.error("Fatal startup error:", err);
      process.exit(1);
    });
}
