import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAddon, listAddons, refreshAddonHealth, registerAddon, setAddonEnabled } from "../addons/addon-registry.js";
import { EUROPEAN_LANGUAGES } from "../languages/european-languages.js";
import { getAppSettings, updateAppSettings } from "../settings/app-settings.js";
import { clearSearchCache, clearSearchHistory, getCachedSearchResult, getSearchHistoryDetails, listCachedSearchResults, listSearchHistory } from "../search/search-cache.js";
import { refreshNow } from "../search/cached-selection.js";
import { aggregateStreams } from "../streams/aggregation.js";
import { clearSystemLogs, listSystemLogs, type SystemLogLevel, writeSystemLog } from "../system/system-log.js";
import { runTechnicalHealthCheck } from "../system/technical-health.js";

const registerAddonSchema = z.object({ manifestUrl: z.string().url(), enabled: z.boolean().optional() });
const updateAddonSchema = z.object({ enabled: z.boolean() });
const aggregateParamsSchema = z.object({ type: z.enum(["movie", "series"]), id: z.string().min(1) });
const limitQuerySchema = z.object({ limit: z.coerce.number().int().positive().max(500).default(50) });
const logsQuerySchema = z.object({ limit: z.coerce.number().int().positive().max(500).default(100), level: z.enum(["debug", "info", "warn", "error"]).optional() });
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

  app.get("/admin/languages", async () => {
    const languages = [...EUROPEAN_LANGUAGES].sort((a, b) => {
      if (a.code === "pl") return -1;
      if (b.code === "pl") return 1;
      if (a.code === "en") return -1;
      if (b.code === "en") return 1;
      return a.nativeName.localeCompare(b.nativeName);
    });

    return {
      languages: languages.map((language) => ({ code: language.code, iso6392: language.iso6392, englishName: language.englishName, nativeName: language.nativeName, label: `${language.nativeName} / ${language.englishName}` }))
    };
  });

  app.patch("/admin/settings", async (request, reply) => {
    const body = settingsSchema.safeParse(request.body);
    if (!body.success) { reply.code(400); return { error: "Invalid settings payload.", details: body.error.flatten() }; }
    const settings = updateAppSettings(body.data);
    writeSystemLog("info", "settings", "Admin settings updated.", { changedKeys: Object.keys(body.data) });
    return { settings };
  });

  app.get("/admin/system/health", async () => {
    const report = await runTechnicalHealthCheck();
    writeSystemLog(report.status === "error" ? "error" : report.status === "warn" ? "warn" : "info", "health", "Technical health-check completed.", { status: report.status });
    return { report };
  });

  app.get<{ Querystring: { limit?: string; level?: SystemLogLevel } }>("/admin/system/logs", async (request, reply) => {
    const query = logsQuerySchema.safeParse(request.query);
    if (!query.success) { reply.code(400); return { error: "Invalid logs query.", details: query.error.flatten() }; }
    return { logs: listSystemLogs(query.data.limit, query.data.level) };
  });

  app.delete("/admin/system/logs", async () => { clearSystemLogs(); writeSystemLog("info", "logs", "System logs cleared."); return { ok: true }; });

  app.get("/admin/addons", async () => ({ addons: listAddons() }));

  app.post("/admin/addons", async (request, reply) => {
    const body = registerAddonSchema.safeParse(request.body);
    if (!body.success) { reply.code(400); return { error: "Invalid addon registration payload.", details: body.error.flatten() }; }
    const addon = await registerAddon(body.data);
    writeSystemLog(addon.status === "online" ? "info" : "warn", "addons", "Addon registered.", { id: addon.id, name: addon.name, manifestUrl: addon.manifestUrl, status: addon.status, lastError: addon.lastError });
    reply.code(201);
    return { addon };
  });

  app.get<{ Params: { type: "movie" | "series"; id: string } }>("/admin/aggregate/:type/:id", async (request, reply) => {
    const params = aggregateParamsSchema.safeParse(request.params);
    if (!params.success) { reply.code(400); return { error: "Invalid aggregation parameters.", details: params.error.flatten() }; }
    writeSystemLog("info", "diagnostics", "Aggregation diagnostics started.", params.data);
    const result = await aggregateStreams(params.data.type, params.data.id);
    writeSystemLog(result.selectedOriginal ? "info" : "warn", "diagnostics", "Aggregation diagnostics completed.", { type: result.type, id: result.id, streamCount: result.streamCount, workingStreamCount: result.workingStreamCount, failedStreamCount: result.failedStreamCount, unsupportedStreamCount: result.unsupportedStreamCount, selectedOriginal: result.selectedOriginal?.title });
    if (getAppSettings().showDiagnosticDetails) return result;
    return { type: result.type, id: result.id, searchedAt: result.searchedAt, addonCount: result.addonCount, successfulAddonCount: result.successfulAddonCount, failedAddonCount: result.failedAddonCount, streamCount: result.streamCount, workingStreamCount: result.workingStreamCount, failedStreamCount: result.failedStreamCount, unsupportedStreamCount: result.unsupportedStreamCount, selectedOriginal: result.selectedOriginal };
  });

  app.get<{ Querystring: { limit?: string } }>("/admin/cache", async (request, reply) => {
    const query = limitQuerySchema.safeParse(request.query);
    if (!query.success) { reply.code(400); return { error: "Invalid cache query.", details: query.error.flatten() }; }
    return { cache: listCachedSearchResults(query.data.limit) };
  });

  app.delete("/admin/cache", async () => {
    const deleted = clearSearchCache();
    writeSystemLog("info", "cache", "Search cache cleared.", { deleted });
    return { ok: true, deleted };
  });

  app.get<{ Querystring: { limit?: string } }>("/admin/history", async (request, reply) => {
    const query = limitQuerySchema.safeParse(request.query);
    if (!query.success) { reply.code(400); return { error: "Invalid history query.", details: query.error.flatten() }; }
    return { history: listSearchHistory(query.data.limit) };
  });

  app.delete("/admin/history", async () => {
    const deleted = clearSearchHistory();
    writeSystemLog("info", "history", "Search history cleared.", { deleted });
    return { ok: true, deleted };
  });

  app.get<{ Params: { historyId: string } }>("/admin/history/:historyId", async (request, reply) => {
    const details = getSearchHistoryDetails(request.params.historyId);
    if (!details) { reply.code(404); return { error: "History entry not found." }; }
    return { details };
  });

  app.get<{ Params: { type: "movie" | "series"; id: string } }>("/admin/cache/:type/:id", async (request, reply) => {
    const params = aggregateParamsSchema.safeParse(request.params);
    if (!params.success) { reply.code(400); return { error: "Invalid cache parameters.", details: params.error.flatten() }; }
    const cached = getCachedSearchResult(params.data.type, params.data.id);
    if (!cached) { reply.code(404); return { error: "Cached result not found." }; }
    return { cached };
  });

  app.post<{ Params: { type: "movie" | "series"; id: string } }>("/admin/cache/:type/:id/refresh", async (request, reply) => {
    const params = aggregateParamsSchema.safeParse(request.params);
    if (!params.success) { reply.code(400); return { error: "Invalid refresh parameters.", details: params.error.flatten() }; }
    writeSystemLog("info", "cache", "Manual cache refresh started.", params.data);
    const selectedOriginal = await refreshNow(params.data.type, params.data.id);
    writeSystemLog(selectedOriginal ? "info" : "warn", "cache", "Manual cache refresh completed.", { ...params.data, selectedOriginal: selectedOriginal?.title });
    return { selectedOriginal };
  });

  app.get<{ Params: { addonId: string } }>("/admin/addons/:addonId", async (request, reply) => {
    const addon = getAddon(request.params.addonId);
    if (!addon) { reply.code(404); return { error: "Addon not found." }; }
    return { addon };
  });

  app.patch<{ Params: { addonId: string } }>("/admin/addons/:addonId", async (request, reply) => {
    const body = updateAddonSchema.safeParse(request.body);
    if (!body.success) { reply.code(400); return { error: "Invalid addon update payload.", details: body.error.flatten() }; }
    const addon = setAddonEnabled(request.params.addonId, body.data.enabled);
    if (!addon) { reply.code(404); return { error: "Addon not found." }; }
    writeSystemLog("info", "addons", body.data.enabled ? "Addon enabled." : "Addon disabled.", { id: addon.id, name: addon.name, manifestUrl: addon.manifestUrl });
    return { addon };
  });

  app.post<{ Params: { addonId: string } }>("/admin/addons/:addonId/check", async (request, reply) => {
    const addon = await refreshAddonHealth(request.params.addonId);
    if (!addon) { reply.code(404); return { error: "Addon not found." }; }
    writeSystemLog(addon.status === "online" ? "info" : "warn", "addons", "Addon health-check completed.", { id: addon.id, name: addon.name, status: addon.status, responseTimeMs: addon.responseTimeMs, lastError: addon.lastError });
    return { addon };
  });
}
