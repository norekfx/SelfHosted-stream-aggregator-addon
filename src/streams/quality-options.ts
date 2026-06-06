import { TRANSCODE_QUALITIES, type TranscodeQuality } from "../stremio/manifest.js";
import type { AggregatedStream, StremioStream } from "./types.js";

export function createVisibleStreamOptions(bestOriginal: AggregatedStream | null, requestBaseUrl: string): StremioStream[] {
  if (!bestOriginal || !bestOriginal.originalUrl || bestOriginal.validationStatus !== "working") {
    return [];
  }

  const encodedOriginalId = encodeURIComponent(bestOriginal.id);

  const original: StremioStream = {
    name: "Original",
    title: buildOriginalTitle(bestOriginal),
    // Return the provider URL directly. Some Stremio players do not reliably follow
    // a self-hosted redirect to Real-Debrid/StremThru playback URLs.
    url: bestOriginal.originalUrl,
    behaviorHints: {
      bingeGroup: "selfhosted-aggregator-original",
      filename: bestOriginal.title,
      notWebReady: false
    }
  };

  const transcoded = TRANSCODE_QUALITIES.map((quality: TranscodeQuality): StremioStream => ({
    name: quality === "auto" ? "Auto" : quality.toUpperCase(),
    title: `Transcoded ${quality === "auto" ? "Auto" : quality.toUpperCase()} from ${bestOriginal.quality ?? "original"}`,
    url: `${requestBaseUrl}/transcode/${encodedOriginalId}/${quality}/master.m3u8`,
    behaviorHints: {
      bingeGroup: `selfhosted-aggregator-${quality}`,
      notWebReady: false,
      filename: `${bestOriginal.title}.${quality}.m3u8`
    }
  }));

  return [original, ...transcoded];
}

function buildOriginalTitle(stream: AggregatedStream): string {
  const parts = [stream.quality, stream.audioLanguage, stream.subtitleLanguage ? `subs: ${stream.subtitleLanguage}` : undefined]
    .filter(Boolean)
    .join(" • ");

  return parts ? `${stream.title}\n${parts}` : stream.title;
}
