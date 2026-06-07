import { getDatabase } from "../db/database.js";
import type { StremioCatalogMeta } from "./types.js";

type LibraryCacheRow = {
  items_json: string;
  expires_at: string;
};

const DEFAULT_TTL_MS = 60 * 60 * 1000;

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

export function saveLibraryItems(libraryId: string, page: number, items: StremioCatalogMeta[], ttlMs = DEFAULT_TTL_MS): void {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
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

export function clearLibraryCache(libraryId?: string): number {
  if (libraryId) {
    return getDatabase().prepare("DELETE FROM library_cache WHERE library_id = ?").run(libraryId).changes;
  }
  return getDatabase().prepare("DELETE FROM library_cache").run().changes;
}

function createLibraryCacheKey(libraryId: string, page: number): string {
  return `${libraryId}:${page}`;
}
