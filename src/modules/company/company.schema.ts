import { z } from "zod";

export const companySearchSchema = z.object({
  q: z.string().min(1, "Search query is required"),
  limit: z.string().optional().default("20"),
  page: z.string().optional().default("1"),
  pincode: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  bankId: z.string().optional(),
  category: z.string().optional(),
});

export type CompanySearchInput = z.infer<typeof companySearchSchema>;
