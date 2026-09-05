import { FastifyRequest, FastifyReply } from "fastify";
import {
  createFeedbackTicket,
  getFeedbackTickets,
  getFeedbackTicketById,
  updateFeedbackTicket,
  deleteFeedbackTicket,
  getFeedbackStats,
  getPublicTicketStatus,
} from "./feedback.service.js";
import { z } from "zod";

const createFeedbackSchema = z.object({
  type: z.enum(["COMPLAINT", "FEEDBACK", "GRIEVANCE", "SUGGESTION", "SUPPORT", "INQUIRY", "ENQUIRY"]).optional().default("FEEDBACK"),
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().optional(),
  subject: z.string().min(3, "Subject is required"),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

const updateFeedbackSchema = z.object({
  status: z.enum(["PENDING", "OPEN", "IN_REVIEW", "IN_PROGRESS", "RESOLVED", "REJECTED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  adminNotes: z.string().optional(),
});

export async function submitFeedbackHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const parseResult = createFeedbackSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parseResult.error.flatten(),
      });
    }

    const { type, name, email, phone, subject, message } = parseResult.data;
    const ipAddress = (request.headers["x-forwarded-for"] as string) || request.ip;
    const userAgent = request.headers["user-agent"] as string;

    const ticket = await createFeedbackTicket({
      type,
      name,
      email,
      phone,
      subject,
      message,
      ipAddress,
      userAgent,
    });

    const isInquiry = ticket.type === "INQUIRY" || ticket.type === "ENQUIRY";

    return reply.status(201).send({
      success: true,
      message: isInquiry
        ? `Your project inquiry has been received. Reference ID: ${ticket.ticketNumber}`
        : `Your ticket has been submitted successfully to support@nvit.space. Reference ID: ${ticket.ticketNumber}`,
      data: {
        ticketNumber: ticket.ticketNumber,
        type: ticket.type,
        status: ticket.status,
        createdAt: ticket.createdAt,
      },
    });
  } catch (error: any) {
    request.log.error(error, "Failed to submit feedback");
    return reply.status(500).send({
      success: false,
      error: "Failed to submit feedback ticket",
    });
  }
}

export async function getPublicTicketStatusHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { ticketNumber } = request.params as { ticketNumber: string };
    if (!ticketNumber || ticketNumber.trim().length < 3) {
      return reply.status(400).send({
        success: false,
        error: "A valid ticket or enquiry reference number is required",
      });
    }

    const ticket = await getPublicTicketStatus(ticketNumber);
    if (!ticket) {
      return reply.status(404).send({
        success: false,
        error: "No enquiry or ticket found with this reference number. Please verify the ID and try again.",
      });
    }

    return reply.send({
      success: true,
      data: ticket,
    });
  } catch (error: any) {
    request.log.error(error, "Failed to fetch ticket status");
    return reply.status(500).send({
      success: false,
      error: "Failed to retrieve status",
    });
  }
}

export async function getFeedbackListHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const query = request.query as any;
    const result = await getFeedbackTickets({
      type: query.type,
      status: query.status,
      search: query.search || query.q,
      page: query.page ? parseInt(query.page, 10) : 1,
      limit: query.limit ? parseInt(query.limit, 10) : 20,
    });

    return reply.send({
      success: true,
      data: result.tickets,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    });
  } catch (error: any) {
    request.log.error(error, "Failed to get feedback list");
    return reply.status(500).send({
      success: false,
      error: "Failed to retrieve feedback list",
    });
  }
}

export async function getFeedbackStatsHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const stats = await getFeedbackStats();
    return reply.send({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    request.log.error(error, "Failed to get feedback stats");
    return reply.status(500).send({
      success: false,
      error: "Failed to retrieve feedback statistics",
    });
  }
}

export async function getFeedbackDetailHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    const ticket = await getFeedbackTicketById(id);

    if (!ticket) {
      return reply.status(404).send({
        success: false,
        error: "Ticket not found",
      });
    }

    return reply.send({
      success: true,
      data: ticket,
    });
  } catch (error: any) {
    request.log.error(error, "Failed to get feedback detail");
    return reply.status(500).send({
      success: false,
      error: "Failed to retrieve ticket details",
    });
  }
}

export async function updateFeedbackHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    const parseResult = updateFeedbackSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: parseResult.error.flatten(),
      });
    }

    const updated = await updateFeedbackTicket(id, parseResult.data);
    return reply.send({
      success: true,
      message: "Ticket updated successfully",
      data: updated,
    });
  } catch (error: any) {
    request.log.error(error, "Failed to update feedback");
    return reply.status(500).send({
      success: false,
      error: "Failed to update ticket",
    });
  }
}

export async function deleteFeedbackHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    await deleteFeedbackTicket(id);
    return reply.send({
      success: true,
      message: "Ticket deleted successfully",
    });
  } catch (error: any) {
    request.log.error(error, "Failed to delete feedback");
    return reply.status(500).send({
      success: false,
      error: "Failed to delete ticket",
    });
  }
}
