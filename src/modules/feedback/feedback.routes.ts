import { FastifyInstance } from "fastify";
import {
  submitFeedbackHandler,
  getPublicTicketStatusHandler,
  getFeedbackListHandler,
  getFeedbackStatsHandler,
  getFeedbackDetailHandler,
  updateFeedbackHandler,
  deleteFeedbackHandler,
} from "./feedback.controller.js";
import { authenticate, authorizeRoles } from "../../middleware/auth.js";

export async function feedbackRoutes(app: FastifyInstance) {
  // Public endpoint for submitting complaints, enquiries & feedback from website / footer
  app.post("/api/v1/feedback", submitFeedbackHandler);
  app.post("/api/feedback", submitFeedbackHandler); // Alias for convenience

  // Public endpoint for tracking enquiry & ticket status by reference number (ENQ-... or TKT-...)
  app.get("/api/v1/feedback/status/:ticketNumber", getPublicTicketStatusHandler);
  app.get("/api/feedback/status/:ticketNumber", getPublicTicketStatusHandler); // Alias for convenience

  // Admin protected endpoints
  const adminHandlers = {
    preHandler: [authenticate, authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "EXECUTIVE", "VIEWER")],
  };
  const writeOpsHandlers = {
    preHandler: [authenticate, authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER")],
  };

  app.get("/api/v1/admin/feedback", adminHandlers, getFeedbackListHandler);
  app.get("/api/v1/admin/feedback/stats", adminHandlers, getFeedbackStatsHandler);
  app.get("/api/v1/admin/feedback/:id", adminHandlers, getFeedbackDetailHandler);
  app.patch("/api/v1/admin/feedback/:id", writeOpsHandlers, updateFeedbackHandler);
  app.delete("/api/v1/admin/feedback/:id", writeOpsHandlers, deleteFeedbackHandler);
}
