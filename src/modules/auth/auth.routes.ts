import { FastifyInstance } from "fastify";
import { loginHandler, logoutHandler, registerHandler, getMeHandler } from "./auth.controller.js";
import { authenticate } from "../../middleware/auth.js";

export async function authRoutes(app: FastifyInstance) {
  // Primary v1 endpoints
  app.post("/api/v1/auth/login", loginHandler);
  app.post("/api/v1/auth/logout", logoutHandler);
  app.post("/api/v1/auth/register", registerHandler);
  app.get("/api/v1/auth/me", { preHandler: [authenticate] }, getMeHandler);

  // Convenience aliases without /v1 or /api prefix
  app.post("/api/auth/login", loginHandler);
  app.post("/auth/login", loginHandler);

  app.post("/api/auth/logout", logoutHandler);
  app.post("/auth/logout", logoutHandler);

  app.post("/api/auth/register", registerHandler);
  app.post("/auth/register", registerHandler);

  app.get("/api/auth/me", { preHandler: [authenticate] }, getMeHandler);
  app.get("/auth/me", { preHandler: [authenticate] }, getMeHandler);
}
