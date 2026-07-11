import { createHash } from "node:crypto";
import { getAppSettings } from "../settings/app-settings.js";
import { aggregateStreams } from "../streams/aggregation.js";
import { saveSelectedOriginal } from "../streams/original-store.js";
import type { AggregatedStream, StreamType } from "../streams/types.js";
import { validateStream } from "../streams/validate-stream-url.js";
import { writeSystemLog } from "../system/system-log.js";
import {
  getCachedSearchResult,
  markCacheServed,
  markRefreshFailed,
  markRefreshStarted,
  saveAggregationResult
} from "./search-cache.js";

const activeRefreshes = new Set<string>();
const FRESH_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const STALE_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export async function getBestOriginalWithCache(type: StreamType, id: string): Promise<AggregatedStream | null> {
  const cached = getCachedSearchResult(type, id);
  const settings = getAppSettings();

  if (cached?.selectedOriginal && cached.status === "working") {
    const cacheAgeMs = getCacheAgeMs(cached.updatedAt);

    if (cacheAgeMs < FRESH_CACHE_MAX_AGE_MS) {
      return serveCachedOriginal(type, id, cached.selectedOriginal);
    }

    if (cacheAgeMs <= STALE_CACHE_MAX_AGE_MS) {
      const original = serveCachedOriginal(type, id, cached.selectedOriginal);
      if (settings.autoRefreshCache) {
        refreshInBackground(type, id);
      }
      return original;
    }

    const validation = await validateStream(
      { url: cached.selectedOriginal.originalUrl },
      settings.streamValidationTimeoutMs
    );

    if (validation.status === "working") {
      const original = serveCachedOriginal(type, id, cached.selectedOriginal);
      if (settings.autoRefreshCache) {
        refreshInBackground(type, id);
      }
      return original;
    }

    writeSystemLog("warn", "cache-revalidation", "Cached stream failed stale-cache validation. Refreshing before serving.", {
      type,
      id,
      cacheAgeMs,
      validationStatus: validation.status,
      validationMethod: validation.method,
      validationReason: validation.reason,
      httpStatus: validation.httpStatus
    });
  }

  return refreshNow(type, id);
}

export async function refreshNow(type: StreamType, id: string): Promise<AggregatedStream | null> {
  const refreshKey = `${type}:${id}`;
  if (activeRefreshes.has(refreshKey)) {
    const cached = getCachedSearchResult(type, id);
    return cached?.selectedOriginal ?? null;
  }

  activeRefreshes.add(refreshKey);
  markRefreshStarted(type, id);

  try {
    const aggregation = await aggregateStreams(type, id);
    const selectedOriginal = aggregation.selectedOriginal;
    const original = selectedOriginal ? toAggregatedStream(type, id, selectedOriginal) : null;

    if (original) {
      saveSelectedOriginal(original);
    }

    saveAggregationResult(aggregation, original);

    if (!original) {
      writeSystemLog("warn", "cache-refresh", "Refresh completed without a working original stream.", {
        type,
        id,
        streamCount: aggregation.streamCount,
        workingStreamCount: aggregation.workingStreamCount,
        failedStreamCount: aggregation.failedStreamCount,
        unsupportedStreamCount: aggregation.unsupportedStreamCount
      });
    }

    return original;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown refresh error.";
    markRefreshFailed(type, id, message);
    writeSystemLog("error", "cache-refresh", message, { type, id });
    throw error;
  } finally {
    activeRefreshes.delete(refreshKey);
  }
}

function refreshInBackground(type: StreamType, id: string): void {
  const refreshKey = `${type}:${id}`;
  if (activeRefreshes.has(refreshKey)) {
    return;
  }

  void refreshNow(type, id).catch(() => {
    // Error is persisted by refreshNow. Do not fail the user's cached response.
  });
}

function serveCachedOriginal(type: StreamType, id: string, original: AggregatedStream): AggregatedStream {
  saveSelectedOriginal(original);
  markCacheServed(type, id);
  return original;
}

function getCacheAgeMs(updatedAt: string): number {
  const updatedAtMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Date.now() - updatedAtMs);
}

function toAggregatedStream(type: StreamType, id: string, selectedOriginal: NonNullable<Awaited<ReturnType<typeof aggregateStreams>>["selectedOriginal"]>): AggregatedStream | null {
  const originalUrl = selectedOriginal.url ?? selectedOriginal.externalUrl;
  if (!originalUrl) {
    return null;
  }

  const fileName = typeof selectedOriginal.behaviorHints?.filename === "string"
    ? selectedOriginal.behaviorHints.filename
    : selectedOriginal.title ?? selectedOriginal.name ?? "Selected original stream";

  return {
    id: createStableOriginalId(selectedOriginal.addonId, type, id, originalUrl),
    name: "Original",
    title: selectedOriginal.title ?? selectedOriginal.name ?? fileName,
    description: selectedOriginal.description,
    sourceAddon: selectedOriginal.addonName,
    originalUrl,
    quality: selectedOriginal.metadata.quality,
    audioLanguage: selectedOriginal.metadata.audioLanguage,
    subtitleLanguage: selectedOriginal.metadata.subtitleLanguage,
    fileName,
    metadata: selectedOriginal.metadata,
    isValidated: true,
    validationStatus: "working",
    validationReason: selectedOriginal.scoreReasons.join("; ")
  };
}

function createStableOriginalId(addonId: string, type: StreamType, id: string, originalUrl: string): string {
  return createHash("sha256").update(`${addonId}|${type}|${id}|${originalUrl}`).digest("base64url").slice(0, 32);
}
