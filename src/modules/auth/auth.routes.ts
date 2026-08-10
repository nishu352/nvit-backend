import { FastifyInstance } from "fastify";
import { loginHandler, registerHandler, getMeHandler } from "./auth.controller.js";
import { authenticate } from "../../middleware/auth.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/v1/auth/login", loginHandler);
  app.post("/api/v1/auth/register", registerHandler);
  app.get("/api/v1/auth/me", { preHandler: [authenticate] }, getMeHandler);
}
