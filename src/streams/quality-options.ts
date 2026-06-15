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
  const originalFileName = buildOriginalFilename(bestOriginal);
  const originalSummary = buildOriginalName(bestOriginal);

  const original: StremioStream = {
    name: originalSummary,
    title: buildOriginalTitle(bestOriginal),
    url: bestOriginal.originalUrl,
    behaviorHints: {
      filename: originalFileName,
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

function buildOriginalName(stream: AggregatedStream): string {
  const metadata = stream.metadata;
  const parts = [
    "Original",
    metadata?.quality && metadata.quality !== "unknown" ? formatQuality(metadata.quality) : stream.quality,
    metadata?.videoCodec && metadata.videoCodec !== "unknown" ? metadata.videoCodec : undefined,
    metadata?.audioCodec && metadata.audioCodec !== "unknown" ? metadata.audioCodec : undefined
  ].filter(Boolean);

  return parts.join(" • ");
}

function buildOriginalTitle(stream: AggregatedStream): string {
  const metadata = stream.metadata;
  const lines = [
    `Plik: ${buildOriginalFilename(stream)}`,
    formatLine("Rozdzielczość", metadata?.quality && metadata.quality !== "unknown" ? formatQuality(metadata.quality) : stream.quality),
    formatLine("Jakość", formatQualityDetails(stream)),
    formatLine("Kodek wideo", metadata?.videoCodec && metadata.videoCodec !== "unknown" ? metadata.videoCodec : undefined),
    formatLine("Audio", formatAudioDetails(stream)),
    formatLine("Kodek audio", metadata?.audioCodec && metadata.audioCodec !== "unknown" ? metadata.audioCodec : undefined),
    formatLine("Napisy", formatSubtitleDetails(stream)),
    formatLine("Rozmiar", metadata?.size),
    formatLine("Addon", stream.sourceAddon),
    stream.description ? `Opis: ${stream.description}` : undefined
  ].filter(Boolean);

  return lines.join("\n");
}

function buildOriginalFilename(stream: AggregatedStream): string {
  return cleanDisplayText(stream.fileName ?? stream.title ?? stream.name ?? "Original");
}

function formatQualityDetails(stream: AggregatedStream): string | undefined {
  const metadata = stream.metadata;
  const parts = [
    metadata?.source && metadata.source !== "unknown" ? metadata.source : undefined,
    metadata?.quality && metadata.quality !== "unknown" ? formatQuality(metadata.quality) : stream.quality,
    metadata?.videoCodec && metadata.videoCodec !== "unknown" ? metadata.videoCodec : undefined,
    metadata?.releaseGroup ? `grupa: ${metadata.releaseGroup}` : undefined
  ].filter(Boolean);
  return parts.length ? parts.join(" • ") : undefined;
}

function formatAudioDetails(stream: AggregatedStream): string | undefined {
  const metadata = stream.metadata;
  const kind = metadata?.audioKind && metadata.audioKind !== "unknown" ? metadata.audioKind : undefined;
  const language = stream.audioLanguage ?? metadata?.audioLanguage;
  const parts = [
    kind ? formatAudioKind(kind) : undefined,
    language ? `język: ${language}` : undefined,
    metadata?.isMultiLanguage ? "multi" : undefined
  ].filter(Boolean);
  return parts.length ? parts.join(" • ") : undefined;
}

function formatSubtitleDetails(stream: AggregatedStream): string | undefined {
  const language = stream.subtitleLanguage ?? stream.metadata?.subtitleLanguage;
  return language ? `wykryte: ${language}` : "brak wykrytych w opisie";
}

function formatLine(label: string, value: string | undefined): string | undefined {
  return value ? `${label}: ${value}` : undefined;
}

function formatQuality(value: string): string {
  return value === "4k" ? "4K / 2160p" : value.toUpperCase();
}

function formatAudioKind(value: string): string {
  switch (value) {
    case "lektor": return "lektor";
    case "dubbing": return "dubbing";
    case "subbed": return "napisy";
    case "multi": return "multi audio";
    case "original": return "oryginalne audio";
    default: return value;
  }
}

function cleanDisplayText(value: string): string {
  return String(value).replace(/\s+/g, " ").trim();
}
