import { getDatabase } from "../db/database.js";
import { getAppSettings, getKometaAnimeIdsRefreshTtlMs } from "../settings/app-settings.js";
import { writeSystemLog } from "../system/system-log.js";

export type KometaAnimeIdsEntry = {
  imdb_id?: string | string[];
  mal_id?: number | string | Array<number | string>;
  anilist_id?: number | string | Array<number | string>;
  tmdb_show_id?: number | string;
  tmdb_movie_id?: number | string;
  title?: string;
  [key: string]: unknown;
};

export type KometaAnimeIdsMatch = {
  source: "kometa-anime-ids";
  matchedBy: "imdb_id" | "tmdb_show_id";
  entryKey: string;
  entry: KometaAnimeIdsEntry;
  malIds: string[];
  anilistIds: string[];
  fetchedAt?: string;
  sizeMb?: number;
};

type CachedPayload = {
  fetchedAt: string;
  sizeBytes: number;
  entries: Record<string, KometaAnimeIdsEntry>;
};

const CACHE_KEY = "docchi_kometa_anime_ids_cache";
const SOURCE_URL = "https://github.com/Kometa-Team/Anime-IDs/raw/master/anime_ids.json";
let memoryCache: CachedPayload | undefined;

export async function resolveKometaAnimeIds(input: { imdbId?: string; tmdbShowId?: number | string }): Promise<KometaAnimeIdsMatch | undefined> {
  const settings = getAppSettings();
  if (!settings.docchiKometaAnimeIdsEnabled) return undefined;
  const payload = await getPayload();
  if (!payload) return undefined;
  const imdbId = input.imdbId?.trim().toLowerCase();
  const tmdbShowId = input.tmdbShowId === undefined ? undefined : String(input.tmdbShowId).trim();
  for (const [entryKey, entry] of Object.entries(payload.entries)) {
    const imdbIds = toStringArray(entry.imdb_id).map((id) => id.toLowerCase());
    if (imdbId && imdbIds.includes(imdbId)) return toMatch("imdb_id", entryKey, entry, payload);
    if (tmdbShowId && String(entry.tmdb_show_id ?? "").trim() === tmdbShowId) return toMatch("tmdb_show_id", entryKey, entry, payload);
  }
  writeSystemLog("info", "docchi", "Kometa Anime-IDs did not contain matching entry.", { imdbId, tmdbShowId, fetchedAt: payload.fetchedAt, entries: Object.keys(payload.entries).length });
  return undefined;
}

async function getPayload(): Promise<CachedPayload | undefined> {
  if (memoryCache && isFresh(memoryCache)) return memoryCache;
  const stored = readStoredPayload();
  if (stored && (isFresh(stored) || getAppSettings().docchiKometaAnimeIdsRefreshInterval === "once")) {
    memoryCache = stored;
    return stored;
  }
  return await downloadPayload(stored);
}

function readStoredPayload(): CachedPayload | undefined {
  const row = getDatabase().prepare("SELECT value FROM app_settings WHERE key = ?").get(CACHE_KEY) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    const parsed = JSON.parse(row.value) as CachedPayload;
    if (parsed?.entries && parsed.fetchedAt) return parsed;
  } catch {}
  return undefined;
}

async function downloadPayload(previous?: CachedPayload): Promise<CachedPayload | undefined> {
  const startedAt = Date.now();
  try {
    const response = await fetch(SOURCE_URL, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const sizeBytes = Buffer.byteLength(text, "utf8");
    const parsed = JSON.parse(text) as Record<string, KometaAnimeIdsEntry>;
    const fetchedAt = new Date().toISOString();
    const payload: CachedPayload = { fetchedAt, sizeBytes, entries: parsed };
    getDatabase().prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(CACHE_KEY, JSON.stringify(payload), fetchedAt);
    memoryCache = payload;
    writeSystemLog("info", "docchi", "Downloaded Kometa Anime-IDs mapping.", { sourceUrl: SOURCE_URL, sizeMb: roundMb(sizeBytes), entries: Object.keys(parsed).length, responseTimeMs: Date.now() - startedAt });
    return payload;
  } catch (error) {
    writeSystemLog("warn", "docchi", "Failed to download Kometa Anime-IDs mapping.", { sourceUrl: SOURCE_URL, error: error instanceof Error ? error.message : "Unknown error", fallbackToCached: Boolean(previous) });
    return previous;
  }
}

function isFresh(payload: CachedPayload): boolean {
  const ttl = getKometaAnimeIdsRefreshTtlMs();
  if (ttl === Number.POSITIVE_INFINITY) return true;
  const fetchedAt = new Date(payload.fetchedAt).getTime();
  return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < ttl;
}

function toMatch(matchedBy: "imdb_id" | "tmdb_show_id", entryKey: string, entry: KometaAnimeIdsEntry, payload: CachedPayload): KometaAnimeIdsMatch {
  return { source: "kometa-anime-ids", matchedBy, entryKey, entry, malIds: toStringArray(entry.mal_id), anilistIds: toStringArray(entry.anilist_id), fetchedAt: payload.fetchedAt, sizeMb: roundMb(payload.sizeBytes) };
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [String(value).trim()].filter(Boolean);
}

function roundMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}
