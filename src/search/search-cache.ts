import { randomUUID } from "node:crypto";
import { getDatabase } from "../db/database.js";
import type { AggregationResult } from "../streams/aggregation.js";
import type { AggregatedStream, StreamType } from "../streams/types.js";

type SearchCacheStatus = "empty" | "working" | "no_result" | "refreshing" | "failed";

type SearchCacheRow = {
  cache_key: string;
  type: StreamType;
  media_id: string;
  selected_original_json: string | null;
  ranked_streams_json: string;
  stats_json: string;
  status: SearchCacheStatus;
  created_at: string;
  updated_at: string;
  last_served_at: string | null;
  refresh_started_at: string | null;
  refresh_finished_at: string | null;
  refresh_error: string | null;
};

type SearchHistoryRow = {
  id: string;
  cache_key: string;
  type: StreamType;
  media_id: string;
  searched_at: string;
  addon_count: number;
  successful_addon_count: number;
  failed_addon_count: number;
  stream_count: number;
  working_stream_count: number;
  failed_stream_count: number;
  unsupported_stream_count: number;
  selected_original_json: string | null;
  result_json: string;
};

export type CachedSearchResult = {
  cacheKey: string;
  type: StreamType;
  mediaId: string;
  selectedOriginal: AggregatedStream | null;
  rankedStreams: unknown[];
  stats: Record<string, unknown>;
  status: SearchCacheStatus;
  createdAt: string;
  updatedAt: string;
  lastServedAt?: string;
  refreshStartedAt?: string;
  refreshFinishedAt?: string;
  refreshError?: string;
};

export type SearchHistoryEntry = {
  id: string;
  cacheKey: string;
  type: StreamType;
  mediaId: string;
  searchedAt: string;
  addonCount: number;
  successfulAddonCount: number;
  failedAddonCount: number;
  streamCount: number;
  workingStreamCount: number;
  failedStreamCount: number;
  unsupportedStreamCount: number;
  selectedOriginal: AggregatedStream | null;
};

export type SearchHistoryDetails = SearchHistoryEntry & {
  result: AggregationResult | null;
};

export function createCacheKey(type: StreamType, mediaId: string): string {
  return `${type}:${mediaId}`;
}

export function getCachedSearchResult(type: StreamType, mediaId: string): CachedSearchResult | undefined {
  const cacheKey = createCacheKey(type, mediaId);
  const row = getDatabase()
    .prepare("SELECT * FROM search_cache WHERE cache_key = ?")
    .get(cacheKey) as SearchCacheRow | undefined;

  return row ? mapCacheRow(row) : undefined;
}

export function listCachedSearchResults(limit = 50): CachedSearchResult[] {
  const rows = getDatabase()
    .prepare("SELECT * FROM search_cache ORDER BY updated_at DESC LIMIT ?")
    .all(limit) as SearchCacheRow[];

  return rows.map(mapCacheRow);
}

export function clearSearchCache(): number {
  const result = getDatabase().prepare("DELETE FROM search_cache").run();
  return result.changes;
}

export function listSearchHistory(limit = 50): SearchHistoryEntry[] {
  const rows = getDatabase()
    .prepare("SELECT * FROM search_history ORDER BY searched_at DESC LIMIT ?")
    .all(limit) as SearchHistoryRow[];

  return rows.map(mapHistoryRow);
}

export function clearSearchHistory(): number {
  const result = getDatabase().prepare("DELETE FROM search_history").run();
  return result.changes;
}

export function getSearchHistoryDetails(historyId: string): SearchHistoryDetails | undefined {
  const row = getDatabase()
    .prepare("SELECT * FROM search_history WHERE id = ?")
    .get(historyId) as SearchHistoryRow | undefined;

  if (!row) {
    return undefined;
  }

  return {
    ...mapHistoryRow(row),
    result: safeParse<AggregationResult | null>(row.result_json, null)
  };
}

export function markCacheServed(type: StreamType, mediaId: string): void {
  getDatabase()
    .prepare("UPDATE search_cache SET last_served_at = ? WHERE cache_key = ?")
    .run(new Date().toISOString(), createCacheKey(type, mediaId));
}

export function markRefreshStarted(type: StreamType, mediaId: string): void {
  const cacheKey = createCacheKey(type, mediaId);
  const now = new Date().toISOString();
  getDatabase()
    .prepare(`
      INSERT INTO search_cache (
        cache_key,
        type,
        media_id,
        status,
        created_at,
        updated_at,
        refresh_started_at
      ) VALUES (?, ?, ?, 'refreshing', ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        status = 'refreshing',
        updated_at = excluded.updated_at,
        refresh_started_at = excluded.refresh_started_at,
        refresh_error = NULL
    `)
    .run(cacheKey, type, mediaId, now, now, now);
}

export function markRefreshFailed(type: StreamType, mediaId: string, error: string): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(`
      UPDATE search_cache
      SET status = 'failed', updated_at = ?, refresh_finished_at = ?, refresh_error = ?
      WHERE cache_key = ?
    `)
    .run(now, now, error, createCacheKey(type, mediaId));
}

export function saveAggregationResult(result: AggregationResult, selectedOriginal: AggregatedStream | null): void {
  const cacheKey = createCacheKey(result.type, result.id);
  const now = new Date().toISOString();
  const status: SearchCacheStatus = selectedOriginal ? "working" : "no_result";
  const stats = {
    addonCount: result.addonCount,
    successfulAddonCount: result.successfulAddonCount,
    failedAddonCount: result.failedAddonCount,
    streamCount: result.streamCount,
    validatedStreamCount: result.validatedStreamCount,
    workingStreamCount: result.workingStreamCount,
    failedStreamCount: result.failedStreamCount,
    unsupportedStreamCount: result.unsupportedStreamCount
  };

  const db = getDatabase();
  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO search_cache (
        cache_key,
        type,
        media_id,
        selected_original_json,
        ranked_streams_json,
        stats_json,
        status,
        created_at,
        updated_at,
        refresh_finished_at,
        refresh_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(cache_key) DO UPDATE SET
        selected_original_json = excluded.selected_original_json,
        ranked_streams_json = excluded.ranked_streams_json,
        stats_json = excluded.stats_json,
        status = excluded.status,
        updated_at = excluded.updated_at,
        refresh_finished_at = excluded.refresh_finished_at,
        refresh_error = NULL
    `).run(
      cacheKey,
      result.type,
      result.id,
      selectedOriginal ? JSON.stringify(selectedOriginal) : null,
      JSON.stringify(result.rankedStreams),
      JSON.stringify(stats),
      status,
      now,
      now,
      now
    );

    db.prepare(`
      INSERT INTO search_history (
        id,
        cache_key,
        type,
        media_id,
        searched_at,
        addon_count,
        successful_addon_count,
        failed_addon_count,
        stream_count,
        working_stream_count,
        failed_stream_count,
        unsupported_stream_count,
        selected_original_json,
        result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      cacheKey,
      result.type,
      result.id,
      result.searchedAt,
      result.addonCount,
      result.successfulAddonCount,
      result.failedAddonCount,
      result.streamCount,
      result.workingStreamCount,
      result.failedStreamCount,
      result.unsupportedStreamCount,
      selectedOriginal ? JSON.stringify(selectedOriginal) : null,
      JSON.stringify(result)
    );
  });

  transaction();
}

function mapCacheRow(row: SearchCacheRow): CachedSearchResult {
  return {
    cacheKey: row.cache_key,
    type: row.type,
    mediaId: row.media_id,
    selectedOriginal: row.selected_original_json ? safeParse<AggregatedStream | null>(row.selected_original_json, null) : null,
    rankedStreams: safeParse<unknown[]>(row.ranked_streams_json, []),
    stats: safeParse<Record<string, unknown>>(row.stats_json, {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastServedAt: row.last_served_at ?? undefined,
    refreshStartedAt: row.refresh_started_at ?? undefined,
    refreshFinishedAt: row.refresh_finished_at ?? undefined,
    refreshError: row.refresh_error ?? undefined
  };
}

function mapHistoryRow(row: SearchHistoryRow): SearchHistoryEntry {
  return {
    id: row.id,
    cacheKey: row.cache_key,
    type: row.type,
    mediaId: row.media_id,
    searchedAt: row.searched_at,
    addonCount: row.addon_count,
    successfulAddonCount: row.successful_addon_count,
    failedAddonCount: row.failed_addon_count,
    streamCount: row.stream_count,
    workingStreamCount: row.working_stream_count,
    failedStreamCount: row.failed_stream_count,
    unsupportedStreamCount: row.unsupported_stream_count,
    selectedOriginal: row.selected_original_json ? safeParse<AggregatedStream | null>(row.selected_original_json, null) : null
  };
}

function safeParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
