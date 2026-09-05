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
import { generateExecutiveEmailDraft } from "../email/geminiEmail.service.js";
import { sendExecutiveReplyEmail } from "../email/email.service.js";
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

/**
 * AI Draft Generator Handler (Powered by Google Gemini 3.7 / 3.5 Flash)
 */
export async function generateAiEmailDraftHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    const ticket = await getFeedbackTicketById(id);
    if (!ticket) {
      return reply.status(404).send({ success: false, error: "Ticket not found" });
    }

    const body = (request.body || {}) as {
      roughNotes?: string;
      tone?: "PROFESSIONAL" | "EMPATHETIC" | "TECHNICAL" | "CLOSURE";
    };

    const draft = await generateExecutiveEmailDraft({
      ticketNumber: ticket.ticketNumber,
      type: ticket.type,
      customerName: ticket.name,
      customerEmail: ticket.email,
      subject: ticket.subject,
      message: ticket.message,
      roughNotes: body.roughNotes,
      tone: body.tone,
    });

    return reply.send({
      success: true,
      data: draft,
    });
  } catch (error: any) {
    request.log.error(error, "Failed to generate AI email draft");
    return reply.status(500).send({
      success: false,
      error: error.message || "Failed to generate AI email draft with Gemini",
    });
  }
}

/**
 * Send Tailored Customer Email Reply Handler (Dispatches via Hostinger API + Logs History)
 */
export async function sendCustomerEmailReplyHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = request.params as { id: string };
    const ticket = await getFeedbackTicketById(id);
    if (!ticket) {
      return reply.status(404).send({ success: false, error: "Ticket not found" });
    }

    const { subject, bodyText, bodyHtml, updateStatus, senderRoleTitle } = request.body as {
      subject: string;
      bodyText: string;
      bodyHtml?: string;
      updateStatus?: "PENDING" | "OPEN" | "IN_REVIEW" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";
      senderRoleTitle?: string;
    };

    if (!subject || !subject.trim()) {
      return reply.status(400).send({ success: false, error: "Email subject is required" });
    }
    if (!bodyText || !bodyText.trim()) {
      return reply.status(400).send({ success: false, error: "Email body content is required" });
    }

    // Convert body text to formatted HTML paragraphs if raw HTML was not provided
    const formattedHtml =
      bodyHtml && bodyHtml.trim().startsWith("<")
        ? bodyHtml
        : `<p style="margin-bottom: 16px;">${bodyText
            .replace(/\n\n+/g, "</p><p style=\"margin-bottom: 16px;\">")
            .replace(/\n/g, "<br/>")}</p>`;

    // 1. Dispatch email via Hostinger Official Mail API
    const mailResult = await sendExecutiveReplyEmail({
      ticket,
      customSubject: subject.trim(),
      bodyHtml: formattedHtml,
      bodyText: bodyText.trim(),
      senderRoleTitle,
    });

    if (!mailResult.success) {
      return reply.status(502).send({
        success: false,
        error: "Failed to dispatch email via Hostinger Mail API. Check server mail logs.",
      });
    }

    // 2. Append dispatched email log to ticket adminNotes
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    const updatedNotes = ticket.adminNotes
      ? `${ticket.adminNotes}\n\n[Official Email Sent • ${timestamp} UTC]:\nSubject: ${subject}\n${bodyText}`
      : `[Official Email Sent • ${timestamp} UTC]:\nSubject: ${subject}\n${bodyText}`;

    // 3. Update ticket notes and optional status
    const updatePayload: any = { adminNotes: updatedNotes };
    if (updateStatus) {
      updatePayload.status = updateStatus;
    }

    const updatedTicket = await updateFeedbackTicket(id, updatePayload);

    return reply.send({
      success: true,
      message: `Executive reply successfully dispatched to ${ticket.email}`,
      data: {
        ticket: updatedTicket,
        dispatchedTo: ticket.email,
        timestamp,
      },
    });
  } catch (error: any) {
    request.log.error(error, "Failed to send customer email reply");
    return reply.status(500).send({
      success: false,
      error: error.message || "Failed to send customer email reply",
    });
  }
}

