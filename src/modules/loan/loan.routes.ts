import { FastifyInstance } from "fastify";
import {
  applyLoanHandler,
  listLoanApplicationsHandler,
  updateLoanStatusHandler,
  assignLoanExecutiveHandler,
  addLoanNoteHandler,
  getCRMLeadsHandler,
  getCustomersHandler,
} from "./loan.controller.js";
import { authenticate, authorizeRoles } from "../../middleware/auth.js";

export async function loanRoutes(app: FastifyInstance) {
  app.post("/api/v1/loan/apply", applyLoanHandler);
  
  const readPreHandlers = { preHandler: [authenticate, authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "EXECUTIVE", "VIEWER")] };
  const writePreHandlers = { preHandler: [authenticate, authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "EXECUTIVE")] };
  const assignPreHandlers = { preHandler: [authenticate, authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER")] };

  app.get("/api/v1/loan/applications", readPreHandlers, listLoanApplicationsHandler);
  app.get("/api/v1/crm/leads", readPreHandlers, getCRMLeadsHandler);
  app.put("/api/v1/crm/leads/:id/status", writePreHandlers, updateLoanStatusHandler);
  app.put("/api/v1/crm/leads/:id/assign", assignPreHandlers, assignLoanExecutiveHandler);
  app.post("/api/v1/crm/leads/:id/notes", writePreHandlers, addLoanNoteHandler);
  app.get("/api/v1/crm/customers", readPreHandlers, getCustomersHandler);
}
