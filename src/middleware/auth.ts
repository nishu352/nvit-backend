import { FastifyRequest, FastifyReply } from "fastify";

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const token =
      request.cookies?.token ||
      request.cookies?.nvit_token ||
      (request.headers.authorization ? request.headers.authorization.replace(/^Bearer\s+/i, "") : null);

    if (!token) {
      return reply.status(401).send({ error: true, message: "Authentication required: No token provided" });
    }

    const decoded = await request.server.jwt.verify(token);
    request.user = decoded;
  } catch (err) {
    return reply.status(401).send({ error: true, message: "Unauthorized access token or expired session" });
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
