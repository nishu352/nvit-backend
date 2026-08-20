import { FastifyRequest, FastifyReply } from "fastify";
import { loginSchema, registerSchema } from "./auth.schema.js";
import { loginUser, registerUser, getUserProfile } from "./auth.service.js";

export async function loginHandler(request: FastifyRequest, reply: FastifyReply) {
  const result = loginSchema.safeParse(request.body);
  if (!result.success) {
    return reply.status(400).send({ error: true, errors: result.error.format() });
  }

  try {
    const user = await loginUser(result.data, request.ip);
    const token = request.server.jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      { expiresIn: process.env.JWT_EXPIRES_IN || "1d" }
    );

    const isProd = process.env.NODE_ENV === "production";
    reply.setCookie("token", token, {
      path: "/",
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: 24 * 60 * 60, // 24 hours
    });

    return reply.send({
      success: true,
      message: "Login successful",
      data: {
        user,
        token,
      },
    });
  } catch (err: any) {
    return reply.status(401).send({ error: true, message: err.message || "Invalid credentials" });
  }
}

export async function logoutHandler(request: FastifyRequest, reply: FastifyReply) {
  const isProd = process.env.NODE_ENV === "production";
  reply.clearCookie("token", {
    path: "/",
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
  });
  return reply.send({
    success: true,
    message: "Logged out successfully",
  });
}

export async function registerHandler(request: FastifyRequest, reply: FastifyReply) {
  const result = registerSchema.safeParse(request.body);
  if (!result.success) {
    return reply.status(400).send({ error: true, errors: result.error.format() });
  }

  try {
    const requestingUser = request.user as { id?: string } | undefined;
    const user = await registerUser(result.data, requestingUser?.id, request.ip);
    const token = request.server.jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      { expiresIn: process.env.JWT_EXPIRES_IN || "1d" }
    );

    return reply.status(201).send({
      success: true,
      message: "User registered successfully",
      data: {
        user,
        token,
      },
    });
  } catch (err: any) {
    return reply.status(400).send({ error: true, message: err.message || "Registration failed" });
  }
}

export async function getMeHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authUser = request.user as { id: string };
    const user = await getUserProfile(authUser.id);
    return reply.send({
      success: true,
      data: user,
    });
  } catch (err: any) {
    return reply.status(404).send({ error: true, message: err.message || "User profile not found" });
  }
}
