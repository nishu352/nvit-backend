import { FastifyInstance } from "fastify";
import { checkPincodeHandler } from "./pincode.controller.js";

export async function pincodeRoutes(app: FastifyInstance) {
  app.get("/api/v1/pincode/check", checkPincodeHandler);
}
