import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import dotenv from "dotenv";

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
      if (
        !origin ||
        process.env.NODE_ENV !== "production" ||
        /http:\/\/localhost:(3000|3001|3002|3003)/.test(origin) ||
        allowedOrigins.includes("*") ||
        allowedOrigins.includes(origin)
      ) {
        cb(null, true);
        return;
      }
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
      fileSize: 50 * 1024 * 1024, // 50MB max file size for Excel imports
    },
  });

  // Register Feature API Routes
  await app.register(authRoutes);
  await app.register(companyRoutes);
  await app.register(pincodeRoutes);
  await app.register(loanRoutes);
  await app.register(importRoutes);
  await app.register(adminRoutes);

  // Root & Health Check Endpoints
  app.get("/", async () => {
    return {
      status: "ok",
      service: "FinVerify Enterprise API Gateway",
      version: "1.0.0",
      health: "/health",
      api: "/api/v1/health",
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/health", async () => {
    return {
      status: "ok",
      platform: "Loan Policy & Company Verification Engine",
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/api/v1/health", async () => {
    return {
      status: "ok",
      service: "FinVerify REST API Gateway",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    };
  });

  // Global Error Handler
  app.setErrorHandler((error: any, request, reply) => {
    app.log.error(error);
    const statusCode = error.statusCode || 500;
    reply.status(statusCode).send({
      error: true,
      statusCode,
      message: error.message || "Internal Server Error",
    });
  });

  return app;
}

if (process.env.NODE_ENV !== "test") {
  buildApp()
    .then((app) => {
      app.listen({ port: PORT, host: HOST }, (err, address) => {
        if (err) {
          app.log.error(err);
          process.exit(1);
        }
        app.log.info(`🚀 Enterprise Backend REST Server listening on ${address}`);

        // Background cleanup — asynchronous & non-blocking for startup
        import("./config/prisma.js")
          .then(({ prisma }) =>
            prisma.importHistory.updateMany({
              where: { status: "PROCESSING" },
              data: {
                status: "FAILED",
                errorMessage: "Import interrupted — server restarted during processing. Please re-upload the file.",
              },
            })
          )
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
      console.error("Failed to start server:", err);
      process.exit(1);
    });
}
