import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  changeAdminPassword,
  createFirstAdmin,
  hasAdminUser,
  listAdminSessions,
  loginAdmin,
  logoutAllSessions,
  logoutOtherSessions,
  logoutSession,
  verifySessionToken
} from "./auth-service.js";

const authSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(10)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10)
});

const cookieName = "ssa_admin_session";

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/auth/status", async (request) => {
    const user = verifySessionToken(readSessionCookie(request));
    return {
      needsRegistration: !hasAdminUser(),
      authenticated: Boolean(user),
      user
    };
  });

  app.post("/auth/register", async (request, reply) => {
    const body = authSchema.safeParse(request.body);
    if (!body.success) {
      reply.code(400);
      return { error: "Invalid registration payload.", details: body.error.flatten() };
    }

    try {
      const session = createFirstAdmin(body.data.username, body.data.password);
      setSessionCookie(reply, session.token, session.expiresAt);
      return { user: session.user, expiresAt: session.expiresAt };
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : "Registration failed." };
    }
  });

  app.post("/auth/login", async (request, reply) => {
    const body = authSchema.safeParse(request.body);
    if (!body.success) {
      reply.code(400);
      return { error: "Invalid login payload.", details: body.error.flatten() };
    }

    try {
      const session = loginAdmin(body.data.username, body.data.password);
      setSessionCookie(reply, session.token, session.expiresAt);
      return { user: session.user, expiresAt: session.expiresAt };
    } catch (error) {
      reply.code(401);
      return { error: error instanceof Error ? error.message : "Login failed." };
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    logoutSession(readSessionCookie(request));
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/auth/sessions", { preHandler: requireAdminAuth }, async (request) => ({
    sessions: listAdminSessions(readSessionCookie(request))
  }));

  app.post("/auth/change-password", { preHandler: requireAdminAuth }, async (request, reply) => {
    const body = changePasswordSchema.safeParse(request.body);
    if (!body.success) {
      reply.code(400);
      return { error: "Invalid password change payload.", details: body.error.flatten() };
    }

    try {
      changeAdminPassword(readSessionCookie(request), body.data.currentPassword, body.data.newPassword);
      return { ok: true };
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : "Password change failed." };
    }
  });

  app.post("/auth/logout-other-sessions", { preHandler: requireAdminAuth }, async (request) => {
    logoutOtherSessions(readSessionCookie(request));
    return { ok: true };
  });

  app.post("/auth/logout-all-sessions", { preHandler: requireAdminAuth }, async (_request, reply) => {
    logoutAllSessions();
    clearSessionCookie(reply);
    return { ok: true };
  });
}

export function requireAdminAuth(request: FastifyRequest, reply: FastifyReply, done: (error?: Error) => void): void {
  const user = verifySessionToken(readSessionCookie(request));
  if (!user) {
    reply.code(401).send({ error: "Authentication required." });
    return;
  }

  done();
}

export function readSessionCookie(request: FastifyRequest): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return undefined;
  }

  const cookies = cookieHeader.split(";").map((part) => part.trim());
  const raw = cookies.find((part) => part.startsWith(`${cookieName}=`));
  return raw ? decodeURIComponent(raw.slice(cookieName.length + 1)) : undefined;
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: string): void {
  reply.header(
    "set-cookie",
    `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`
  );
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.header("set-cookie", `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
