import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAddon, listAddons, refreshAddonHealth, registerAddon, setAddonEnabled } from "../addons/addon-registry.js";
import { EUROPEAN_LANGUAGES } from "../languages/european-languages.js";
import { getAppSettings, getEffectivePublicBaseUrl, LINK_VALIDATION_MODES, TRANSCODE_PRESETS, TRANSCODE_QUALITY_ORDER, updateAppSettings } from "../settings/app-settings.js";
import { clearSearchCache, clearSearchHistory, getCachedSearchResult, getSearchHistoryDetails, listCachedSearchResults, listSearchHistory } from "../search/search-cache.js";
import { refreshNow } from "../search/cached-selection.js";
import { aggregateStreams } from "../streams/aggregation.js";
import { saveSelectedOriginal } from "../streams/original-store.js";
import type { AggregatedStream, StreamType } from "../streams/types.js";
import { TRANSCODE_QUALITIES } from "../stremio/manifest.js";
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
  preferDebrid: z.boolean().optional(),
  detectDebridPlaceholders: z.boolean().optional(),
  debridPlaceholderValidationMode: z.enum(LINK_VALIDATION_MODES).optional(),
  debridPlaceholderMinSizeMb: z.coerce.number().int().min(1).max(102400).optional(),
  debridPlaceholderMinDurationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  debridPlaceholderCompareDeclaredSize: z.boolean().optional(),
  debridPlaceholderSizeDifferenceGb: z.coerce.number().int().min(1).max(1024).optional(),
  defaultTranscodeBufferPreset: z.string().optional(),
  streamValidationTimeoutMs: z.coerce.number().int().positive().max(120000).optional(),
  linkValidationMode: z.enum(LINK_VALIDATION_MODES).optional(),
  maxTranscodeSessions: z.coerce.number().int().positive().max(16).optional(),
  publicBaseUrl: z.string().url().optional().or(z.literal("")),
  autoRefreshCache: z.boolean().optional(),
  showDiagnosticDetails: z.boolean().optional(),
  autoTranscodeMinQuality: z.enum(TRANSCODE_QUALITY_ORDER).optional(),
  autoTranscodeMaxQuality: z.enum(TRANSCODE_QUALITY_ORDER).optional(),
  transcodePreset: z.enum(TRANSCODE_PRESETS).optional(),
  transcodeCrfMode: z.enum(["auto", "range"]).optional(),
  transcodeCrfMin: z.coerce.number().int().min(16).max(35).optional(),
  transcodeCrfMax: z.coerce.number().int().min(16).max(35).optional(),
  transcodeBitrateMode: z.enum(["auto", "range"]).optional(),
  transcodeBitrateMinKbps: z.coerce.number().int().min(150).max(50000).optional(),
  transcodeBitrateMaxKbps: z.coerce.number().int().min(150).max(50000).optional()
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
    return { languages: languages.map((language) => ({ code: language.code, iso6392: language.iso6392, englishName: language.englishName, nativeName: language.nativeName, label: `${language.nativeName} / ${language.englishName}` })) };
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

  app.get<{ Params: { type: "movie" | "series"; id: string } }>("/admin/transcode/candidates/:type/:id", async (request, reply) => {
    const params = aggregateParamsSchema.safeParse(request.params);
    if (!params.success) { reply.code(400); return { error: "Invalid transcode diagnostics parameters.", details: params.error.flatten() }; }
    writeSystemLog("info", "transcode-diagnostics", "Transcode candidates scan started.", params.data);
    const result = await aggregateStreams(params.data.type, params.data.id);
    const requestBaseUrl = getEffectivePublicBaseUrl() ?? `${request.protocol}://${request.hostname}`;
    const candidates = result.rankedStreams.slice(0, 50).map((stream) => {
      const original = toDiagnosticAggregatedStream(params.data.type, params.data.id, stream);
      saveSelectedOriginal(original);
      const encodedId = encodeURIComponent(original.id);
      return {
        id: original.id,
        title: original.title,
        addon: original.sourceAddon,
        originalUrl: original.originalUrl,
        quality: original.quality,
        audioLanguage: original.audioLanguage,
        subtitleLanguage: original.subtitleLanguage,
        validationReason: original.validationReason,
        score: stream.score,
        scoreReasons: stream.scoreReasons,
        urls: {
          original: original.originalUrl,
          ...Object.fromEntries(TRANSCODE_QUALITIES.map((quality) => [quality, `${requestBaseUrl}/transcode/${encodedId}/${quality}/master.m3u8`]))
        }
      };
    });
    writeSystemLog("info", "transcode-diagnostics", "Transcode candidates scan completed.", { ...params.data, candidates: candidates.length, workingStreamCount: result.workingStreamCount });
    return { type: params.data.type, id: params.data.id, candidates };
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

  app.get<{ Params: { type: StreamType; id: string } }>("/admin/cache/:type/:id/refresh", async (request, reply) => {
    const params = aggregateParamsSchema.safeParse(request.params);
    if (!params.success) { reply.code(400); return { error: "Invalid refresh parameters.", details: params.error.flatten() }; }
    await refreshNow(params.data.type, params.data.id);
    return getCachedSearchResult(params.data.type, params.data.id) ?? { status: "refreshing" };
  });

  app.post<{ Params: { type: StreamType; id: string } }>("/admin/cache/:type/:id/refresh", async (request, reply) => {
    const params = aggregateParamsSchema.safeParse(request.params);
    if (!params.success) { reply.code(400); return { error: "Invalid refresh parameters.", details: params.error.flatten() }; }
    await refreshNow(params.data.type, params.data.id);
    return getCachedSearchResult(params.data.type, params.data.id) ?? { status: "refreshing" };
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

  app.get("/admin/addons/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const addon = getAddon(id);
    if (!addon) { reply.code(404); return { error: "Addon not found." }; }
    return { addon };
  });

  app.post("/admin/addons/:id/check", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const addon = await refreshAddonHealth(id);
    if (!addon) { reply.code(404); return { error: "Addon not found." }; }
    return { addon };
  });

  app.patch("/admin/addons/:id", async (request, reply) => {
    const body = updateAddonSchema.safeParse(request.body);
    if (!body.success) { reply.code(400); return { error: "Invalid addon update payload.", details: body.error.flatten() }; }
    const id = (request.params as { id: string }).id;
    const addon = setAddonEnabled(id, body.data.enabled);
    if (!addon) { reply.code(404); return { error: "Addon not found." }; }
    return { addon };
  });
}

function toDiagnosticAggregatedStream(type: StreamType, mediaId: string, stream: any): AggregatedStream {
  const title = stream.title ?? stream.name ?? stream.infoHash ?? stream.url ?? "Unknown stream";
  const hash = createHash("sha1").update(JSON.stringify({ type, mediaId, url: stream.url, externalUrl: stream.externalUrl, infoHash: stream.infoHash, fileIdx: stream.fileIdx, title, addonId: stream.addonId })).digest("hex");
  const validationStatus = stream.validation?.status === "working" || stream.validation?.status === "failed" ? stream.validation.status : "pending";
  return {
    id: `${type}:${mediaId}:${hash}`,
    title,
    name: stream.name ?? title,
    originalUrl: stream.url ?? stream.externalUrl,
    sourceAddon: stream.addonName ?? stream.addonId,
    quality: stream.metadata?.quality,
    audioLanguage: stream.metadata?.audioLanguage,
    subtitleLanguage: stream.metadata?.subtitleLanguage,
    isValidated: validationStatus !== "pending",
    validationStatus,
    validationReason: stream.validation?.reason
  };
}
