import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAddon, listAddons, refreshAddonHealth, registerAddon, setAddonEnabled } from "../addons/addon-registry.js";
import { getCachedSearchResult, listCachedSearchResults, listSearchHistory } from "../search/search-cache.js";
import { refreshNow } from "../search/cached-selection.js";
import { aggregateStreams } from "../streams/aggregation.js";

const registerAddonSchema = z.object({
  manifestUrl: z.string().url(),
  enabled: z.boolean().optional()
});

const updateAddonSchema = z.object({
  enabled: z.boolean()
});

const aggregateParamsSchema = z.object({
  type: z.enum(["movie", "series"]),
  id: z.string().min(1)
});

const limitQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(50)
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

  app.get<{ Params: { type: "movie" | "series"; id: string } }>("/admin/aggregate/:type/:id", async (request, reply) => {
    const params = aggregateParamsSchema.safeParse(request.params);
    if (!params.success) {
      reply.code(400);
      return { error: "Invalid aggregation parameters.", details: params.error.flatten() };
    }

    return aggregateStreams(params.data.type, params.data.id);
  });

  app.get<{ Querystring: { limit?: string } }>("/admin/cache", async (request, reply) => {
    const query = limitQuerySchema.safeParse(request.query);
    if (!query.success) {
      reply.code(400);
      return { error: "Invalid cache query.", details: query.error.flatten() };
    }

    return { cache: listCachedSearchResults(query.data.limit) };
  });

  app.get<{ Querystring: { limit?: string } }>("/admin/history", async (request, reply) => {
    const query = limitQuerySchema.safeParse(request.query);
    if (!query.success) {
      reply.code(400);
      return { error: "Invalid history query.", details: query.error.flatten() };
    }

    return { history: listSearchHistory(query.data.limit) };
  });

  app.get<{ Params: { type: "movie" | "series"; id: string } }>("/admin/cache/:type/:id", async (request, reply) => {
    const params = aggregateParamsSchema.safeParse(request.params);
    if (!params.success) {
      reply.code(400);
      return { error: "Invalid cache parameters.", details: params.error.flatten() };
    }

    const cached = getCachedSearchResult(params.data.type, params.data.id);
    if (!cached) {
      reply.code(404);
      return { error: "Cached result not found." };
    }

    return { cached };
  });

  app.post<{ Params: { type: "movie" | "series"; id: string } }>("/admin/cache/:type/:id/refresh", async (request, reply) => {
    const params = aggregateParamsSchema.safeParse(request.params);
    if (!params.success) {
      reply.code(400);
      return { error: "Invalid refresh parameters.", details: params.error.flatten() };
    }

    const selectedOriginal = await refreshNow(params.data.type, params.data.id);
    return { selectedOriginal };
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
