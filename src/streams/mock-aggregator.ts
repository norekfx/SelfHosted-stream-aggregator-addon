import { aggregateStreams } from "./aggregation.js";
import type { AggregatedStream, StreamType } from "./types.js";

/**
 * Selects exactly one validated source as Original.
 * All visible quality options are generated later as transcoding endpoints
 * based on this same original source, never as separate addon results.
 */
export async function findBestValidatedStream(type: StreamType, id: string): Promise<AggregatedStream | null> {
  const aggregation = await aggregateStreams(type, id);
  const selectedOriginal = aggregation.selectedOriginal;

  if (!selectedOriginal) {
    return null;
  }

  const originalUrl = selectedOriginal.url ?? selectedOriginal.externalUrl;
  if (!originalUrl) {
    return null;
  }

  return {
    id: createStableOriginalId(selectedOriginal.addonId, type, id, originalUrl),
    name: "Original",
    title: selectedOriginal.title ?? selectedOriginal.name ?? "Selected original stream",
    sourceAddon: selectedOriginal.addonName,
    originalUrl,
    quality: selectedOriginal.metadata.quality,
    audioLanguage: selectedOriginal.metadata.audioLanguage,
    subtitleLanguage: selectedOriginal.metadata.subtitleLanguage,
    isValidated: true,
    validationStatus: "working",
    validationReason: selectedOriginal.scoreReasons.join("; ")
  };
}

function createStableOriginalId(addonId: string, type: StreamType, id: string, originalUrl: string): string {
  return Buffer.from(`${addonId}|${type}|${id}|${originalUrl}`).toString("base64url");
}
