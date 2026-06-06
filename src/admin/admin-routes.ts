import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAddon, listAddons, refreshAddonHealth, registerAddon, setAddonEnabled } from "../addons/addon-registry.js";
import { getAppSettings, updateAppSettings } from "../settings/app-settings.js";
import { getCachedSearchResult, listCachedSearchResults, listSearchHistory } from "../search/search-cache.js";
import { refreshNow } from "../search/cached-selection.js";
import { aggregateStreams } from "../streams/aggregation.js";
import { clearSystemLogs, listSystemLogs, type SystemLogLevel } from "../system/system-log.js";
import { runTechnicalHealthCheck } from "../system/technical-health.js";

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

const logsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(100),
  level: z.enum(["debug", "info", "warn", "error"]).optional()
});

const settingsSchema = z.object({
  preferredAudioLanguage: z.string().min(2).optional(),
  preferredSubtitleLanguage: z.string().min(2).optional(),
  defaultTranscodeBufferPreset: z.string().optional(),
  streamValidationTimeoutMs: z.coerce.number().int().positive().max(120000).optional(),
  maxTranscodeSessions: z.coerce.number().int().positive().max(16).optional(),
  publicBaseUrl: z.string().url().optional().or(z.literal("")),
  autoRefreshCache: z.boolean().optional(),
  showDiagnosticDetails: z.boolean().optional()
});

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/settings", async () => ({ settings: getAppSettings() }));

  app.patch("/admin/settings", async (request, reply) => {
    const body = settingsSchema.safeParse(request.body);
    if (!body.success) {
      reply.code(400);
      return { error: "Invalid settings payload.", details: body.error.flatten() };
    }

    const settings = updateAppSettings({
      ...body.data,
      publicBaseUrl: body.data.publicBaseUrl === "" ? undefined : body.data.publicBaseUrl
    });
    return { settings };
  });

  app.get("/admin/system/health", async () => ({ report: await runTechnicalHealthCheck() }));

  app.get<{ Querystring: { limit?: string; level?: SystemLogLevel } }>("/admin/system/logs", async (request, reply) => {
    const query = logsQuerySchema.safeParse(request.query);
    if (!query.success) {
      reply.code(400);
      return { error: "Invalid logs query.", details: query.error.flatten() };
    }

    return { logs: listSystemLogs(query.data.limit, query.data.level) };
  });

  app.delete("/admin/system/logs", async () => {
    clearSystemLogs();
    return { ok: true };
  });

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

    const result = await aggregateStreams(params.data.type, params.data.id);
    if (getAppSettings().showDiagnosticDetails) {
      return result;
    }

    return {
      type: result.type,
      id: result.id,
      searchedAt: result.searchedAt,
      addonCount: result.addonCount,
      successfulAddonCount: result.successfulAddonCount,
      failedAddonCount: result.failedAddonCount,
      streamCount: result.streamCount,
      workingStreamCount: result.workingStreamCount,
      failedStreamCount: result.failedStreamCount,
      unsupportedStreamCount: result.unsupportedStreamCount,
      selectedOriginal: result.selectedOriginal
    };
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
