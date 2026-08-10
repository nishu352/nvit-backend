import { z } from "zod";

export const companySearchSchema = z.object({
  q: z.string().min(1, "Search query is required"),
  limit: z.string().optional().default("20"),
});

export type CompanySearchInput = z.infer<typeof companySearchSchema>;
