import { getDatabase } from "../db/database.js";
import { getEffectivePublicBaseUrl } from "../settings/app-settings.js";
import type { StreamType } from "../streams/types.js";
import type { AnimeSubSubtitleFetchResult, ExternalSubtitle } from "./animesub-client.js";
import { getLocalSubtitleContent, toPublicSubtitle, type LocalCachedSubtitle } from "./subtitle-local-cache.js";

export type CachedSubtitle = LocalCachedSubtitle & {
  addonId: string;
  addonName?: string;
  requestUrl?: string;
  fetchedAt: string;
};

export type SubtitleCacheEntry = {
  type: StreamType;
  mediaId: string;
  fetchedAt: string;
  updatedAt: string;
  addonResults: Array<{ addonId: string; addonName?: string; status: "fulfilled" | "rejected"; responseTimeMs: number; subtitleCount: number; error?: string; requestUrl: string }>;
  subtitles: CachedSubtitle[];
};

export function getSubtitleCache(type: StreamType, mediaId: string): SubtitleCacheEntry | undefined {
  const row = getDatabase().prepare("SELECT * FROM subtitle_cache WHERE type = ? AND media_id = ?").get(type, mediaId) as SubtitleCacheRow | undefined;
  if (!row) return undefined;
  return rowToEntry(row);
}

export function saveSubtitleCache(type: StreamType, mediaId: string, results: AnimeSubSubtitleFetchResult[]): SubtitleCacheEntry {
  const now = new Date().toISOString();
  const subtitles: CachedSubtitle[] = results.flatMap((result) => result.subtitles.map((subtitle) => ({
    ...subtitle,
    addonId: result.addon.id,
    addonName: result.addon.name,
    requestUrl: result.requestUrl,
    fetchedAt: now
  })));
  const addonResults = results.map((result) => ({
    addonId: result.addon.id,
    addonName: result.addon.name,
    status: result.status,
    responseTimeMs: result.responseTimeMs,
    subtitleCount: result.subtitles.length,
    error: result.error,
    requestUrl: result.requestUrl
  }));
  getDatabase().prepare(`
    INSERT INTO subtitle_cache (cache_key, type, media_id, subtitles_json, addon_results_json, fetched_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      subtitles_json = excluded.subtitles_json,
      addon_results_json = excluded.addon_results_json,
      fetched_at = excluded.fetched_at,
      updated_at = excluded.updated_at
  `).run(cacheKey(type, mediaId), type, mediaId, JSON.stringify(subtitles), JSON.stringify(addonResults), now, now);
  return { type, mediaId, fetchedAt: now, updatedAt: now, addonResults, subtitles };
}

export function listSubtitleCache(limit = 100): SubtitleCacheEntry[] {
  const rows = getDatabase().prepare("SELECT * FROM subtitle_cache ORDER BY updated_at DESC LIMIT ?").all(limit) as SubtitleCacheRow[];
  return rows.map(rowToEntry);
}

export function clearSubtitleCache(type?: StreamType, mediaId?: string): number {
  if (type && mediaId) {
    const result = getDatabase().prepare("DELETE FROM subtitle_cache WHERE type = ? AND media_id = ?").run(type, mediaId);
    return result.changes;
  }
  const result = getDatabase().prepare("DELETE FROM subtitle_cache").run();
  return result.changes;
}

export function getLocalSubtitle(type: StreamType, mediaId: string, index: number): { content: string; contentType: string } | undefined {
  const entry = getSubtitleCache(type, mediaId);
  return getLocalSubtitleContent(entry?.subtitles[index]);
}

export function toStremioSubtitleResponse(entry: SubtitleCacheEntry | undefined, publicBaseUrl?: string): { subtitles: ExternalSubtitle[] } {
  const baseUrl = (publicBaseUrl ?? getEffectivePublicBaseUrl() ?? "").replace(/\/$/, "");
  return { subtitles: entry?.subtitles.map(({ addonId, addonName, requestUrl, fetchedAt, ...subtitle }) => toPublicSubtitle(subtitle, baseUrl)) ?? [] };
}

function rowToEntry(row: SubtitleCacheRow): SubtitleCacheEntry {
  return {
    type: row.type as StreamType,
    mediaId: row.media_id,
    fetchedAt: row.fetched_at,
    updatedAt: row.updated_at,
    addonResults: parseJson(row.addon_results_json, []),
    subtitles: parseJson(row.subtitles_json, [])
  };
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function cacheKey(type: StreamType, mediaId: string): string {
  return `${type}:${mediaId}`;
}

type SubtitleCacheRow = {
  cache_key: string;
  type: string;
  media_id: string;
  subtitles_json: string;
  addon_results_json: string;
  fetched_at: string;
  updated_at: string;
};
