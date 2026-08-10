import { z } from "zod";

export const applyLoanSchema = z.object({
  name: z.string().min(2, "Full Name is required"),
  mobile: z.string().regex(/^[6-9]\d{9}$/, "Please enter a valid 10-digit Indian mobile number"),
  email: z.string().email("Invalid email address"),
  city: z.string().min(2, "City is required"),
  state: z.string().min(2, "State is required"),
  company: z.string().min(2, "Company Name is required"),
  monthlyIncome: z.number().positive("Monthly income must be greater than 0"),
  loanType: z.string().min(2, "Loan Type is required"),
  loanAmount: z.number().positive("Loan amount must be greater than 0"),
  remarks: z.string().optional(),
});

export type ApplyLoanInput = z.infer<typeof applyLoanSchema>;
