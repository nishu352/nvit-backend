import { prisma } from "../../config/prisma.js";
import { ApplyLoanInput } from "./loan.schema.js";
import { createAuditLog } from "../../utils/auditLogger.js";

export async function createLoanApplication(input: ApplyLoanInput, ipAddress?: string) {
  const application = await prisma.loanApplication.create({
    data: {
      name: input.name.trim(),
      mobile: input.mobile.trim(),
      email: input.email.toLowerCase().trim(),
      city: input.city.trim(),
      state: input.state.trim(),
      company: input.company.trim(),
      monthlyIncome: input.monthlyIncome,
      loanType: input.loanType,
      loanAmount: input.loanAmount,
      remarks: input.remarks ? input.remarks.trim() : null,
      status: "FRESH",
    },
  });

  await createAuditLog({
    action: "LOAN_APPLICATION_SUBMITTED",
    entity: "LoanApplication",
    entityId: application.id,
    details: {
      applicant: application.name,
      amount: application.loanAmount,
      type: application.loanType,
    },
    ipAddress,
  });

  return application;
}

export async function getLoanApplications(page: number = 1, limit: number = 20) {
  const skip = (page - 1) * limit;

  const [total, items] = await Promise.all([
    prisma.loanApplication.count(),
    prisma.loanApplication.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    total,
    page,
    totalPages: Math.ceil(total / limit),
    items,
  };
}

export async function updateLoanStatus(id: string, status: string, remarks?: string, userEmail?: string) {
  const application = await prisma.loanApplication.findUnique({ where: { id } });
  if (!application) throw new Error("Loan application not found");

  const existingTimeline = typeof application.timeline === "string" 
    ? JSON.parse(application.timeline) 
    : (Array.isArray(application.timeline) ? application.timeline : []);

  existingTimeline.push({
    status,
    remarks: remarks || `Status changed to ${status}`,
    updatedBy: userEmail || "System",
    timestamp: new Date().toISOString(),
  });

  const updated = await prisma.loanApplication.update({
    where: { id },
    data: {
      status: status as any,
      remarks: remarks || application.remarks,
      timeline: existingTimeline,
    },
  });

  await createAuditLog({
    userEmail: userEmail || "System",
    action: "LOAN_STATUS_UPDATED",
    entity: "LoanApplication",
    entityId: id,
    details: { oldStatus: application.status, newStatus: status },
  });

  return updated;
}

export async function assignLoanExecutive(id: string, assignedExecutiveId: string) {
  return await prisma.loanApplication.update({
    where: { id },
    data: { assignedExecutiveId },
  });
}

export async function addLoanNote(id: string, note: string, userEmail?: string) {
  const application = await prisma.loanApplication.findUnique({ where: { id } });
  if (!application) throw new Error("Loan application not found");

  const existingNotes = typeof application.internalNotes === "string" 
    ? JSON.parse(application.internalNotes) 
    : (Array.isArray(application.internalNotes) ? application.internalNotes : []);

  existingNotes.push({
    note: note.trim(),
    createdBy: userEmail || "Admin",
    timestamp: new Date().toISOString(),
  });

  return await prisma.loanApplication.update({
    where: { id },
    data: {
      internalNotes: existingNotes,
    },
  });
}

export async function getCRMLeadsList(status?: string, assignedExecutiveId?: string, query?: string) {
  const whereClause: any = {};
  if (status) whereClause.status = status;
  if (assignedExecutiveId) whereClause.assignedExecutiveId = assignedExecutiveId;
  if (query) {
    whereClause.OR = [
      { name: { contains: query } },
      { mobile: { contains: query } },
      { email: { contains: query } },
      { company: { contains: query } },
    ];
  }

  return await prisma.loanApplication.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    include: {
      assignedExecutive: {
        select: { id: true, name: true, email: true }
      }
    }
  });
}

export async function getCustomerProfiles(page: number = 1, limit: number = 30, query?: string) {
  const skip = (page - 1) * limit;
  const whereClause: any = {};
  if (query) {
    whereClause.OR = [
      { name: { contains: query } },
      { mobile: { contains: query } },
      { email: { contains: query } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.loanApplication.count({ where: whereClause }),
    prisma.loanApplication.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    total,
    page,
    totalPages: Math.ceil(total / limit),
    items,
  };
}
