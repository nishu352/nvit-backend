import { prisma } from "../../config/prisma.js";
import {
  sendEnquiryConfirmationEmail,
  sendTicketConfirmationEmail,
  sendStatusUpdateEmail,
} from "../email/email.service.js";

export interface CreateFeedbackInput {
  type?: string;
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface FeedbackFilterInput {
  type?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export async function createFeedbackTicket(input: CreateFeedbackInput) {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomSuffix = Math.floor(1000 + Math.random() * 9000).toString();
  const rawType = (input.type || "FEEDBACK").toUpperCase();
  const isInquiry = rawType === "INQUIRY" || rawType === "ENQUIRY";
  const normalizedType = isInquiry ? "INQUIRY" : rawType;
  const prefix = isInquiry ? "ENQ" : "TKT";
  const ticketNumber = `${prefix}-${dateStr}-${randomSuffix}`;

  const ticket = await prisma.feedbackTicket.create({
    data: {
      ticketNumber,
      type: normalizedType,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone?.trim() || null,
      subject: input.subject.trim(),
      message: input.message.trim(),
      status: "PENDING",
      priority: (normalizedType === "COMPLAINT" || normalizedType === "GRIEVANCE") ? "HIGH" : "NORMAL",
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    },
  });

  // Non-blocking background email dispatch
  const emailPayload = {
    ticketNumber: ticket.ticketNumber,
    type: ticket.type,
    name: ticket.name,
    email: ticket.email,
    subject: ticket.subject,
    message: ticket.message,
    status: ticket.status,
    createdAt: ticket.createdAt,
  };

  if (isInquiry) {
    sendEnquiryConfirmationEmail(emailPayload).catch((err: any) =>
      console.error("[EmailService] Background enquiry dispatch error:", err.message)
    );
  } else {
    sendTicketConfirmationEmail(emailPayload).catch((err: any) =>
      console.error("[EmailService] Background ticket dispatch error:", err.message)
    );
  }

  return ticket;
}

export async function getFeedbackTickets(filters: FeedbackFilterInput) {
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, Math.max(1, filters.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = {};

  if (filters.type && filters.type !== "ALL") {
    const tp = filters.type.toUpperCase();
    if (tp === "INQUIRY" || tp === "ENQUIRY") {
      where.type = { in: ["INQUIRY", "ENQUIRY"] };
    } else {
      where.type = tp;
    }
  }

  if (filters.status && filters.status !== "ALL") {
    const st = filters.status.toUpperCase();
    if (st === "OPEN" || st === "PENDING") {
      where.status = { in: ["OPEN", "PENDING"] };
    } else if (st === "IN_PROGRESS" || st === "IN_REVIEW") {
      where.status = { in: ["IN_PROGRESS", "IN_REVIEW"] };
    } else {
      where.status = st;
    }
  }

  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim();
    where.OR = [
      { ticketNumber: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
      { message: { contains: q, mode: "insensitive" } },
    ];
  }

  const [tickets, total] = await Promise.all([
    prisma.feedbackTicket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.feedbackTicket.count({ where }),
  ]);

  return {
    tickets,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getFeedbackTicketById(id: string) {
  return prisma.feedbackTicket.findUnique({
    where: { id },
  });
}

export async function getPublicTicketStatus(identifier: string) {
  const cleanId = identifier.trim();
  if (!cleanId) return null;

  const ticket = await prisma.feedbackTicket.findFirst({
    where: {
      OR: [
        { ticketNumber: { equals: cleanId, mode: "insensitive" } },
        { id: { equals: cleanId, mode: "insensitive" } },
      ],
    },
  });

  if (!ticket) return null;

  // Mask sensitive information for public display
  const maskEmail = (email: string) => {
    const parts = email.split("@");
    if (parts.length !== 2) return "***@***.com";
    const [user, domain] = parts;
    const visibleChars = Math.min(2, Math.floor(user.length / 2));
    return `${user.slice(0, visibleChars)}***@${domain}`;
  };

  const maskName = (name: string) => {
    return name
      .split(" ")
      .map((part) => (part.length > 1 ? `${part[0]}***` : part))
      .join(" ");
  };

  return {
    ticketNumber: ticket.ticketNumber,
    type: ticket.type,
    subject: ticket.subject,
    status: ticket.status,
    maskedName: maskName(ticket.name),
    maskedEmail: maskEmail(ticket.email),
    createdAt: ticket.createdAt,
    resolvedAt: ticket.resolvedAt,
    adminNotes: (ticket.status === "RESOLVED" || ticket.status === "IN_REVIEW" || ticket.status === "IN_PROGRESS") ? ticket.adminNotes : null,
  };
}

export async function updateFeedbackTicket(
  id: string,
  data: {
    status?: string;
    priority?: string;
    adminNotes?: string;
  }
) {
  const currentTicket = await prisma.feedbackTicket.findUnique({ where: { id } });
  if (!currentTicket) throw new Error("Ticket not found");

  const prevStatus = currentTicket.status;
  const prevNotes = currentTicket.adminNotes || "";

  const updateData: any = {};
  if (data.status) {
    let st = data.status.toUpperCase();
    if (st === "OPEN") st = "PENDING";
    if (st === "IN_PROGRESS") st = "IN_REVIEW";
    updateData.status = st;
    if (st === "RESOLVED") {
      updateData.resolvedAt = new Date();
    }
  }
  if (data.priority) {
    updateData.priority = data.priority.toUpperCase();
  }
  if (data.adminNotes !== undefined) {
    updateData.adminNotes = data.adminNotes;
  }

  const updatedTicket = await prisma.feedbackTicket.update({
    where: { id },
    data: updateData,
  });

  // Non-blocking background status update email dispatch
  const statusChanged = updateData.status && updateData.status !== prevStatus;
  const notesChanged =
    updateData.adminNotes !== undefined &&
    updateData.adminNotes.trim() !== prevNotes.trim() &&
    updateData.adminNotes.trim().length > 0;

  if (statusChanged || notesChanged) {
    sendStatusUpdateEmail(
      {
        ticketNumber: updatedTicket.ticketNumber,
        type: updatedTicket.type,
        name: updatedTicket.name,
        email: updatedTicket.email,
        subject: updatedTicket.subject,
        status: updatedTicket.status,
        adminNotes: updatedTicket.adminNotes,
        createdAt: updatedTicket.createdAt,
        resolvedAt: updatedTicket.resolvedAt,
      },
      prevStatus
    ).catch((err: any) =>
      console.error("[EmailService] Background status update dispatch error:", err.message)
    );
  }

  return updatedTicket;
}

export async function deleteFeedbackTicket(id: string) {
  return prisma.feedbackTicket.delete({
    where: { id },
  });
}

export async function getFeedbackStats() {
  const [total, pending, open, inReview, inProgress, resolved, complaints, feedbackCount, grievances, inquiries] =
    await Promise.all([
      prisma.feedbackTicket.count(),
      prisma.feedbackTicket.count({ where: { status: "PENDING" } }),
      prisma.feedbackTicket.count({ where: { status: "OPEN" } }),
      prisma.feedbackTicket.count({ where: { status: "IN_REVIEW" } }),
      prisma.feedbackTicket.count({ where: { status: "IN_PROGRESS" } }),
      prisma.feedbackTicket.count({ where: { status: "RESOLVED" } }),
      prisma.feedbackTicket.count({ where: { type: "COMPLAINT" } }),
      prisma.feedbackTicket.count({ where: { type: "FEEDBACK" } }),
      prisma.feedbackTicket.count({ where: { type: "GRIEVANCE" } }),
      prisma.feedbackTicket.count({ where: { type: { in: ["INQUIRY", "ENQUIRY"] } } }),
    ]);

  const totalOpen = pending + open;
  const totalInProgress = inReview + inProgress;

  return {
    total,
    pending: totalOpen,
    inReview: totalInProgress,
    resolved,
    byStatus: {
      OPEN: totalOpen,
      IN_PROGRESS: totalInProgress,
      RESOLVED: resolved,
    },
    byType: {
      complaints,
      feedback: feedbackCount,
      grievances,
      inquiries,
    },
  };
}
