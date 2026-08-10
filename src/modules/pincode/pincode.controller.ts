import { FastifyRequest, FastifyReply } from "fastify";
import { pincodeCheckSchema } from "./pincode.schema.js";
import { checkPincodeServiceability } from "./pincode.service.js";

export async function checkPincodeHandler(request: FastifyRequest, reply: FastifyReply) {
  const result = pincodeCheckSchema.safeParse(request.query);
  if (!result.success) {
    return reply.status(400).send({ error: true, errors: result.error.format() });
  }

  try {
    const data = await checkPincodeServiceability(result.data.pincode);
    return reply.send({
      success: true,
      data,
    });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Pincode lookup error" });
  }
}
