import { FastifyRequest, FastifyReply } from "fastify";
import { applyLoanSchema } from "./loan.schema.js";
import {
  createLoanApplication,
  getLoanApplications,
  updateLoanStatus,
  assignLoanExecutive,
  addLoanNote,
  getCRMLeadsList,
  getCustomerProfiles,
} from "./loan.service.js";

export async function applyLoanHandler(request: FastifyRequest, reply: FastifyReply) {
  const result = applyLoanSchema.safeParse(request.body);
  if (!result.success) {
    return reply.status(400).send({ error: true, errors: result.error.format() });
  }

  try {
    const application = await createLoanApplication(result.data, request.ip);
    return reply.status(201).send({
      success: true,
      message: "Loan application submitted successfully. Our team will contact you shortly.",
      data: {
        applicationId: application.id,
        status: application.status,
        createdAt: application.createdAt,
      },
    });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Loan application submission failed" });
  }
}

export async function listLoanApplicationsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { page, limit } = request.query as { page?: string; limit?: string };
  const pageNum = parseInt(page || "1", 10);
  const limitNum = parseInt(limit || "20", 10);

  try {
    const data = await getLoanApplications(pageNum, limitNum);
    return reply.send({
      success: true,
      data,
    });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch loan applications" });
  }
}

export async function updateLoanStatusHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { status, remarks } = request.body as { status: string; remarks?: string };
  const user = request.user as { id: string; email?: string; role: string } | undefined;

  try {
    // Executive check: can only update their own leads
    if (user?.role === "EXECUTIVE") {
      const { prisma } = await import("../../config/prisma.js");
      const application = await prisma.loanApplication.findUnique({ where: { id } });
      if (!application || application.assignedExecutiveId !== user.id) {
        return reply.status(403).send({ error: true, message: "Forbidden: You can only update your assigned leads" });
      }
    }
    const updated = await updateLoanStatus(id, status, remarks, user?.email);
    return reply.send({ success: true, data: updated });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to update loan status" });
  }
}

export async function assignLoanExecutiveHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { assignedToId } = request.body as { assignedToId: string };

  try {
    const updated = await assignLoanExecutive(id, assignedToId);
    return reply.send({ success: true, data: updated });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to assign executive" });
  }
}

export async function addLoanNoteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { note } = request.body as { note: string };
  const user = request.user as { id: string; email?: string; role: string } | undefined;

  try {
    // Executive check: can only add notes to their own leads
    if (user?.role === "EXECUTIVE") {
      const { prisma } = await import("../../config/prisma.js");
      const application = await prisma.loanApplication.findUnique({ where: { id } });
      if (!application || application.assignedExecutiveId !== user.id) {
        return reply.status(403).send({ error: true, message: "Forbidden: You can only comment on your assigned leads" });
      }
    }
    const updated = await addLoanNote(id, note, user?.email);
    return reply.send({ success: true, data: updated });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Failed to add note" });
  }
}

export async function getCRMLeadsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { status, assignedToId, query } = request.query as { status?: string; assignedToId?: string; query?: string };
  const user = request.user as { id: string; role: string };

  try {
    // Executive check: can only fetch leads assigned to themselves
    const targetExecutiveId = user.role === "EXECUTIVE" ? user.id : assignedToId;
    const leads = await getCRMLeadsList(status, targetExecutiveId, query);
    return reply.send({ success: true, data: leads });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch CRM leads" });
  }
}

export async function getCustomersHandler(request: FastifyRequest, reply: FastifyReply) {
  const { page, limit, query } = request.query as { page?: string; limit?: string; query?: string };
  const pageNum = parseInt(page || "1", 10);
  const limitNum = parseInt(limit || "30", 10);

  try {
    const customers = await getCustomerProfiles(pageNum, limitNum, query);
    return reply.send({ success: true, data: customers });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to fetch customers" });
  }
}
