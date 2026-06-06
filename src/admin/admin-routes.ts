import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAddon, listAddons, refreshAddonHealth, registerAddon, setAddonEnabled } from "../addons/addon-registry.js";

const registerAddonSchema = z.object({
  manifestUrl: z.string().url(),
  enabled: z.boolean().optional()
});

const updateAddonSchema = z.object({
  enabled: z.boolean()
});

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/addons", async () => ({ addons: listAddons() }));

  app.post("/admin/addons", async (request, reply) => {
    const body = registerAddonSchema.safeParse(request.body);
    if (!body.success) {
      reply.code(400);
      return { error: "Invalid addon registration payload.", details: body.error.flatten() };
    }

    const addon = await registerAddon(body.data);
    reply.code(201);
    return { addon };
  });

  app.get<{ Params: { addonId: string } }>("/admin/addons/:addonId", async (request, reply) => {
    const addon = getAddon(request.params.addonId);
    if (!addon) {
      reply.code(404);
      return { error: "Addon not found." };
    }

    return { addon };
  });

  app.patch<{ Params: { addonId: string } }>("/admin/addons/:addonId", async (request, reply) => {
    const body = updateAddonSchema.safeParse(request.body);
    if (!body.success) {
      reply.code(400);
      return { error: "Invalid addon update payload.", details: body.error.flatten() };
    }

    const addon = setAddonEnabled(request.params.addonId, body.data.enabled);
    if (!addon) {
      reply.code(404);
      return { error: "Addon not found." };
    }

    return { addon };
  });

  app.post<{ Params: { addonId: string } }>("/admin/addons/:addonId/check", async (request, reply) => {
    const addon = await refreshAddonHealth(request.params.addonId);
    if (!addon) {
      reply.code(404);
      return { error: "Addon not found." };
    }

    return { addon };
  });
}
