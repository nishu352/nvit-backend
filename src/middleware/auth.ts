import { FastifyRequest, FastifyReply } from "fastify";

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: true, message: "Unauthorized access token" });
  }
}

export function authorizeRoles(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { role?: string };
    if (!user || !user.role || !roles.includes(user.role)) {
      reply.status(403).send({ error: true, message: "Forbidden: Insufficient privileges" });
    }
  };
}
