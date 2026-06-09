import { getDatabase } from "../db/database.js";
import { getEffectivePublicBaseUrl } from "../settings/app-settings.js";
import type { StreamType } from "../streams/types.js";
import type { AnimeSubSubtitleFetchResult, ExternalSubtitle } from "./animesub-client.js";
import { getLocalSubtitleContent, toPublicSubtitle, type LocalCachedSubtitle } from "./subtitle-local-cache.js";

export type CachedSubtitle = LocalCachedSubtitle & { addonId: string; addonName?: string; requestUrl?: string; fetchedAt: string };
export type SubtitleCacheEntry = { type: StreamType; mediaId: string; fetchedAt: string; updatedAt: string; addonResults: Array<{ addonId: string; addonName?: string; status: "fulfilled" | "rejected"; responseTimeMs: number; subtitleCount: number; error?: string; requestUrl: string }>; subtitles: CachedSubtitle[] };

export function getSubtitleCache(type: StreamType, mediaId: string): SubtitleCacheEntry | undefined { const row = getDatabase().prepare("SELECT * FROM subtitle_cache WHERE type = ? AND media_id = ?").get(type, mediaId) as SubtitleCacheRow | undefined; return row ? rowToEntry(row) : undefined; }
export function saveSubtitleCache(type: StreamType, mediaId: string, results: AnimeSubSubtitleFetchResult[]): SubtitleCacheEntry { const now = new Date().toISOString(); const subtitles: CachedSubtitle[] = results.flatMap((result) => result.subtitles.map((subtitle) => ({ ...subtitle, addonId: result.addon.id, addonName: result.addon.name, requestUrl: result.requestUrl, fetchedAt: now }))); const addonResults = results.map((result) => ({ addonId: result.addon.id, addonName: result.addon.name, status: result.status, responseTimeMs: result.responseTimeMs, subtitleCount: result.subtitles.length, error: result.error, requestUrl: result.requestUrl })); getDatabase().prepare(`INSERT INTO subtitle_cache (cache_key, type, media_id, subtitles_json, addon_results_json, fetched_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET subtitles_json = excluded.subtitles_json, addon_results_json = excluded.addon_results_json, fetched_at = excluded.fetched_at, updated_at = excluded.updated_at`).run(cacheKey(type, mediaId), type, mediaId, JSON.stringify(subtitles), JSON.stringify(addonResults), now, now); return { type, mediaId, fetchedAt: now, updatedAt: now, addonResults, subtitles }; }
export function listSubtitleCache(limit = 100): SubtitleCacheEntry[] { const rows = getDatabase().prepare("SELECT * FROM subtitle_cache ORDER BY updated_at DESC LIMIT ?").all(limit) as SubtitleCacheRow[]; return rows.map(rowToEntry); }
export function clearSubtitleCache(type?: StreamType, mediaId?: string): number { if (type && mediaId) return getDatabase().prepare("DELETE FROM subtitle_cache WHERE type = ? AND media_id = ?").run(type, mediaId).changes; return getDatabase().prepare("DELETE FROM subtitle_cache").run().changes; }
export function getLocalSubtitle(type: StreamType, mediaId: string, index: number): { content: string; contentType: string } | undefined { const entry = getSubtitleCache(type, mediaId); return getLocalSubtitleContent(entry?.subtitles[index]); }

export function toStremioSubtitleResponse(entry: SubtitleCacheEntry | undefined, publicBaseUrl?: string): { subtitles: ExternalSubtitle[] } {
  const baseUrl = (publicBaseUrl ?? getEffectivePublicBaseUrl() ?? "").replace(/\/$/, "");
  const subtitles = entry?.subtitles.map(({ addonId, addonName, requestUrl, fetchedAt, ...subtitle }, index) => {
    const publicSubtitle = toPublicSubtitle(subtitle, baseUrl);
    return normalizeForStremio(publicSubtitle, index, addonName);
  }) ?? [];
  return { subtitles };
}

function normalizeForStremio(subtitle: ExternalSubtitle, index: number, addonName?: string): ExternalSubtitle {
  const lang = normalizeSubtitleLang(subtitle.lang);
  const id = sanitizeSubtitleId(subtitle.id, index);
  const nameBase = subtitle.name?.trim() || addonName?.trim() || "Polski";
  return { ...subtitle, id, lang, name: nameBase.includes("SelfHosted") ? nameBase : `${nameBase} · SelfHosted Stream Aggregator` };
}

function normalizeSubtitleLang(value: string | undefined): string {
  const normalized = (value || "pl").trim().toLowerCase();
  if (["pl", "pol", "polish", "polski", "pl-pl"].includes(normalized)) return "pol";
  if (["en", "eng", "english", "en-us", "en-gb"].includes(normalized)) return "eng";
  if (["jp", "ja", "jpn", "japanese"].includes(normalized)) return "jpn";
  if (normalized.length === 2) return normalized;
  return normalized.slice(0, 12) || "pol";
}

function sanitizeSubtitleId(value: string | undefined, index: number): string {
  const id = (value || `selfhosted-pol-${index + 1}`).trim().replace(/[^a-z0-9._:-]+/gi, "-").replace(/^-+|-+$/g, "");
  return id || `selfhosted-pol-${index + 1}`;
}

function rowToEntry(row: SubtitleCacheRow): SubtitleCacheEntry { return { type: row.type as StreamType, mediaId: row.media_id, fetchedAt: row.fetched_at, updatedAt: row.updated_at, addonResults: parseJson(row.addon_results_json, []), subtitles: parseJson(row.subtitles_json, []) }; }
function parseJson<T>(value: string | null | undefined, fallback: T): T { if (!value) return fallback; try { return JSON.parse(value) as T; } catch { return fallback; } }
function cacheKey(type: StreamType, mediaId: string): string { return `${type}:${mediaId}`; }
type SubtitleCacheRow = { cache_key: string; type: string; media_id: string; subtitles_json: string; addon_results_json: string; fetched_at: string; updated_at: string };
