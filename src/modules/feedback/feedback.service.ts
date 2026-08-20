import { prisma } from "../../config/prisma.js";

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
  const ticketNumber = `TKT-${dateStr}-${randomSuffix}`;

  const ticket = await prisma.feedbackTicket.create({
    data: {
      ticketNumber,
      type: (input.type || "FEEDBACK").toUpperCase(),
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone?.trim() || null,
      subject: input.subject.trim(),
      message: input.message.trim(),
      status: "PENDING",
      priority: input.type?.toUpperCase() === "COMPLAINT" ? "HIGH" : "NORMAL",
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    },
  });

  return ticket;
}

export async function getFeedbackTickets(filters: FeedbackFilterInput) {
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, Math.max(1, filters.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = {};

  if (filters.type && filters.type !== "ALL") {
    where.type = filters.type.toUpperCase();
  }

  if (filters.status && filters.status !== "ALL") {
    where.status = filters.status.toUpperCase();
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

export async function updateFeedbackTicket(
  id: string,
  data: {
    status?: string;
    priority?: string;
    adminNotes?: string;
  }
) {
  const updateData: any = {};
  if (data.status) {
    updateData.status = data.status.toUpperCase();
    if (updateData.status === "RESOLVED") {
      updateData.resolvedAt = new Date();
    }
  }
  if (data.priority) {
    updateData.priority = data.priority.toUpperCase();
  }
  if (data.adminNotes !== undefined) {
    updateData.adminNotes = data.adminNotes;
  }

  return prisma.feedbackTicket.update({
    where: { id },
    data: updateData,
  });
}

export async function deleteFeedbackTicket(id: string) {
  return prisma.feedbackTicket.delete({
    where: { id },
  });
}

export async function getFeedbackStats() {
  const [total, pending, inReview, resolved, complaints, feedbackCount, grievances] =
    await Promise.all([
      prisma.feedbackTicket.count(),
      prisma.feedbackTicket.count({ where: { status: "PENDING" } }),
      prisma.feedbackTicket.count({ where: { status: "IN_REVIEW" } }),
      prisma.feedbackTicket.count({ where: { status: "RESOLVED" } }),
      prisma.feedbackTicket.count({ where: { type: "COMPLAINT" } }),
      prisma.feedbackTicket.count({ where: { type: "FEEDBACK" } }),
      prisma.feedbackTicket.count({ where: { type: "GRIEVANCE" } }),
    ]);

  return {
    total,
    pending,
    inReview,
    resolved,
    byType: {
      complaints,
      feedback: feedbackCount,
      grievances,
    },
  };
}
