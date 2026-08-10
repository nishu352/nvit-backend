import { FastifyInstance } from "fastify";
import { searchCompaniesHandler, autocompleteHandler } from "./company.controller.js";

export async function companyRoutes(app: FastifyInstance) {
  app.get("/api/v1/company/search", searchCompaniesHandler);
  app.get("/api/v1/company/autocomplete", autocompleteHandler);
}
