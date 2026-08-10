import { z } from "zod";

export const pincodeCheckSchema = z.object({
  pincode: z.string().min(6, "Pincode must be 6 digits").max(6, "Pincode must be 6 digits"),
});

export type PincodeCheckInput = z.infer<typeof pincodeCheckSchema>;
