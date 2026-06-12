import { getEffectiveTranscodeMode } from "../settings/app-settings.js";
import { TRANSCODE_QUALITIES, type TranscodeQuality } from "../stremio/manifest.js";
import type { AggregatedStream, StremioStream } from "./types.js";

export function createVisibleStreamOptions(bestOriginal: AggregatedStream | null, requestBaseUrl: string): StremioStream[] {
  if (!bestOriginal || !bestOriginal.originalUrl || bestOriginal.validationStatus !== "working") {
    return [];
  }

  const encodedOriginalId = encodeURIComponent(bestOriginal.id);
  const transcodeMode = getEffectiveTranscodeMode();
  const transcodePath = transcodeMode === "vod" ? "transcode-vod" : "transcode";

  const original: StremioStream = {
    name: "Original",
    title: buildOriginalTitle(bestOriginal),
    url: bestOriginal.originalUrl,
    behaviorHints: {
      filename: bestOriginal.title,
      notWebReady: false
    }
  };

  const transcoded = TRANSCODE_QUALITIES.map((quality: TranscodeQuality): StremioStream => ({
    name: quality === "auto" ? "Auto" : quality.toUpperCase(),
    title: `${quality === "auto" ? "Auto" : quality.toUpperCase()} from ${bestOriginal.quality ?? "original"}`,
    url: `${requestBaseUrl}/${transcodePath}/${encodedOriginalId}/${quality}/master.m3u8`,
    behaviorHints: {
      notWebReady: false,
      filename: `${bestOriginal.title}.${transcodeMode}.${quality}.m3u8`
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
