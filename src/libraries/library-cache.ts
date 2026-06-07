import { getDatabase } from "../db/database.js";
import { getMetadataSyncTtlMs } from "../settings/app-settings.js";
import type { StremioCatalogMeta } from "./types.js";

type LibraryCacheRow = {
  items_json: string;
  expires_at: string;
};

export function getCachedLibraryItems(libraryId: string, page: number): StremioCatalogMeta[] | undefined {
  const cacheKey = createLibraryCacheKey(libraryId, page);
  const row = getDatabase()
    .prepare("SELECT items_json, expires_at FROM library_cache WHERE cache_key = ?")
    .get(cacheKey) as LibraryCacheRow | undefined;

  if (!row) return undefined;
  if (Date.parse(row.expires_at) <= Date.now()) return undefined;

  try {
    const parsed = JSON.parse(row.items_json) as unknown;
    return Array.isArray(parsed) ? parsed as StremioCatalogMeta[] : undefined;
  } catch {
    return undefined;
  }
}

export function saveLibraryItems(libraryId: string, page: number, items: StremioCatalogMeta[]): void {
  const now = new Date();
  const ttlMs = getMetadataSyncTtlMs();
  const expiresAt = new Date(now.getTime() + Math.max(ttlMs, 1));
  getDatabase()
    .prepare(`
      INSERT INTO library_cache (cache_key, library_id, page, items_json, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        items_json = excluded.items_json,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `)
    .run(createLibraryCacheKey(libraryId, page), libraryId, page, JSON.stringify(items), now.toISOString(), expiresAt.toISOString());
}

export function getCachedMeta(type: string, imdbId: string): StremioCatalogMeta | undefined {
  const row = getDatabase()
    .prepare("SELECT items_json, expires_at FROM library_cache WHERE cache_key = ?")
    .get(createMetaCacheKey(type, imdbId)) as LibraryCacheRow | undefined;
  if (!row) return undefined;
  if (Date.parse(row.expires_at) <= Date.now()) return undefined;
  try {
    const parsed = JSON.parse(row.items_json) as unknown;
    return parsed && typeof parsed === "object" ? parsed as StremioCatalogMeta : undefined;
  } catch {
    return undefined;
  }
}

export function saveMeta(type: string, imdbId: string, meta: StremioCatalogMeta): void {
  const now = new Date();
  const ttlMs = getMetadataSyncTtlMs();
  const expiresAt = new Date(now.getTime() + Math.max(ttlMs, 1));
  getDatabase()
    .prepare(`
      INSERT INTO library_cache (cache_key, library_id, page, items_json, created_at, expires_at)
      VALUES (?, ?, 0, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        items_json = excluded.items_json,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `)
    .run(createMetaCacheKey(type, imdbId), `meta:${type}`, JSON.stringify(meta), now.toISOString(), expiresAt.toISOString());
}

export function clearLibraryCache(libraryId?: string): number {
  if (libraryId) {
    return getDatabase().prepare("DELETE FROM library_cache WHERE library_id = ?").run(libraryId).changes;
  }
  return getDatabase().prepare("DELETE FROM library_cache").run().changes;
}

export function shouldBypassMetadataCache(): boolean {
  return getMetadataSyncTtlMs() <= 0;
}

function createLibraryCacheKey(libraryId: string, page: number): string {
  return `${libraryId}:${page}`;
}

function createMetaCacheKey(type: string, imdbId: string): string {
  return `meta:${type}:${imdbId}`;
}
