import type { StreamType } from "../streams/types.js";
import { writeSystemLog } from "../system/system-log.js";
import type { AnimeSubSubtitleFetchResult, ExternalSubtitle } from "./animesub-client.js";

const MAX_LOCAL_SUBTITLE_BYTES = 16 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30000;

export type LocalCachedSubtitle = ExternalSubtitle & {
  originalUrl?: string;
  originalFormat?: string;
  localFormat?: "vtt";
  localPath?: string;
  localContent?: string;
  localContentType?: string;
  localBytes?: number;
  localError?: string;
  passThroughOriginal?: boolean;
};

export type SubtitleLocalizationOptions = {
  passThroughOriginal?: boolean;
  startIndex?: number;
};

export async function localizeSubtitleResults(type: StreamType, mediaId: string, results: AnimeSubSubtitleFetchResult[], options: SubtitleLocalizationOptions = {}): Promise<AnimeSubSubtitleFetchResult[]> {
  const localizedResults: AnimeSubSubtitleFetchResult[] = [];
  let globalIndex = options.startIndex ?? 0;
  for (const result of results) {
    const localizedSubtitles: ExternalSubtitle[] = [];
    for (const subtitle of result.subtitles) {
      localizedSubtitles.push(await localizeSubtitle(type, mediaId, subtitle, globalIndex, result.requestUrl, options));
      globalIndex += 1;
    }
    localizedResults.push({ ...result, subtitles: localizedSubtitles });
  }
  return localizedResults;
}

export function toPublicSubtitle(subtitle: LocalCachedSubtitle, publicBaseUrl: string): ExternalSubtitle {
  const { localContent, localContentType, localBytes, localError, localPath, localFormat, originalFormat, originalUrl, passThroughOriginal, ...external } = subtitle;
  if (localPath && localContent) return { ...external, id: external.id ? `${external.id}-vtt` : undefined, name: external.name ? `${external.name} (WebVTT local)` : "WebVTT local", url: `${publicBaseUrl}${localPath}` };
  return external;
}

export function toOriginalSubtitle(subtitle: LocalCachedSubtitle): ExternalSubtitle | undefined {
  const { localContent, localContentType, localBytes, localError, localPath, localFormat, originalFormat, originalUrl, passThroughOriginal, ...external } = subtitle;
  const url = originalUrl ?? external.url;
  if (!url) return undefined;
  return { ...external, id: external.id ? `${external.id}-original` : undefined, name: external.name ? `${external.name} (oryginalne)` : "Oryginalne napisy", url };
}

export function getLocalSubtitleContent(subtitle: LocalCachedSubtitle | undefined): { content: string; contentType: string } | undefined { if (!subtitle?.localContent) return undefined; return { content: subtitle.localContent, contentType: subtitle.localContentType ?? "text/vtt; charset=utf-8" }; }

async function localizeSubtitle(type: StreamType, mediaId: string, subtitle: ExternalSubtitle | undefined, index: number, requestUrl: string, options: SubtitleLocalizationOptions): Promise<ExternalSubtitle> {
  if (!subtitle?.url) return markPassThrough(subtitle ?? {}, options);
  const startedAt = Date.now();
  const originalFormat = inferSubtitleFormat(subtitle.url, subtitle.name);
  try {
    const downloaded = await downloadSubtitleText(subtitle.url);
    const localContent = convertToWebVtt(downloaded.text, originalFormat);
    const localPath = `/subtitles/local/${encodeURIComponent(type)}/${encodeURIComponent(mediaId)}/${index}.vtt`;
    writeSystemLog("info", "subtitles", "Subtitle converted and cached locally.", { type, mediaId, index, subtitleId: subtitle.id, originalFormat, localFormat: "vtt", originalBytes: downloaded.bytes, localBytes: Buffer.byteLength(localContent, "utf8"), responseTimeMs: Date.now() - startedAt, requestUrl });
    return { ...markPassThrough(subtitle, options), originalUrl: (subtitle as LocalCachedSubtitle).originalUrl ?? subtitle.url, originalFormat, localFormat: "vtt", localPath, localContent, localContentType: "text/vtt; charset=utf-8", localBytes: Buffer.byteLength(localContent, "utf8") } as LocalCachedSubtitle;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeSystemLog("warn", "subtitles", "Subtitle local conversion failed; keeping diagnostic record.", { type, mediaId, index, subtitleId: subtitle.id, originalFormat, error: message, responseTimeMs: Date.now() - startedAt, requestUrl });
    return { ...markPassThrough(subtitle, options), originalUrl: (subtitle as LocalCachedSubtitle).originalUrl ?? subtitle.url, originalFormat, localError: message } as LocalCachedSubtitle;
  }
}

function markPassThrough(subtitle: ExternalSubtitle, options: SubtitleLocalizationOptions): ExternalSubtitle {
  return options.passThroughOriginal ? { ...subtitle, passThroughOriginal: true } as ExternalSubtitle : subtitle;
}

async function downloadSubtitleText(url: string): Promise<{ text: string; bytes: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { accept: "text/vtt,text/srt,text/plain,application/x-subrip,application/octet-stream,*/*", "accept-language": "pl,en;q=0.8", "user-agent": "Mozilla/5.0 (compatible; SelfHostedStreamAggregator/0.1)" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Subtitle file download failed with HTTP ${response.status}.`);
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_LOCAL_SUBTITLE_BYTES) throw new Error(`Subtitle file is too large: ${arrayBuffer.byteLength} bytes.`);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(arrayBuffer);
    if (!text.trim()) throw new Error("Subtitle file is empty.");
    return { text, bytes: arrayBuffer.byteLength };
  } catch (error) { if (error instanceof Error && error.name === "AbortError") throw new Error(`Subtitle file download timed out after ${DOWNLOAD_TIMEOUT_MS}ms.`); throw error; }
  finally { clearTimeout(timeout); }
}

function convertToWebVtt(text: string, detectedFormat: string): string { const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim(); if (/^WEBVTT\b/i.test(normalized)) return normalizeWebVtt(normalized); if (detectedFormat === "ass" || detectedFormat === "ssa" || /\[Script Info\]/i.test(normalized)) return assToWebVtt(normalized); return srtToWebVtt(normalized); }
function normalizeWebVtt(text: string): string { return text.replace(/^(WEBVTT[^\n]*)(?:\n{3,})?/i, "$1\n\n"); }
function srtToWebVtt(text: string): string { const body = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2 --> $3.$4").replace(/\{\\[^}]+\}/g, "").replace(/<font[^>]*>/gi, "").replace(/<\/font>/gi, ""); return `WEBVTT\n\n${body}\n`; }
function assToWebVtt(text: string): string { const eventsIndex = text.search(/^\[Events\]/im); const events = eventsIndex >= 0 ? text.slice(eventsIndex) : text; const lines = events.split("\n"); const dialogue = lines.filter((line) => /^Dialogue:/i.test(line)); if (!dialogue.length) return srtToWebVtt(text); const cues = dialogue.map((line) => { const raw = line.replace(/^Dialogue:\s*/i, ""); const parts = raw.split(","); if (parts.length < 10) return ""; const start = assTimeToVtt(parts[1] ?? "0:00:00.00"); const end = assTimeToVtt(parts[2] ?? "0:00:00.00"); const content = parts.slice(9).join(",").replace(/\{[^}]+\}/g, "").replace(/\\N/g, "\n").trim(); if (!content) return ""; return `${start} --> ${end}\n${content}`; }).filter(Boolean); return `WEBVTT\n\n${cues.join("\n\n")}\n`; }
function assTimeToVtt(value: string): string { const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/); if (!match) return "00:00:00.000"; return `${String(Number(match[1] ?? "0")).padStart(2, "0")}:${match[2]}:${match[3]}.${match[4]}0`; }
function inferSubtitleFormat(url = "", name = ""): string { const value = `${url} ${name}`.toLowerCase().split("?")[0] || ""; if (/\.vtt\b/.test(value) || /webvtt/.test(value)) return "vtt"; if (/\.srt\b/.test(value) || /srt/.test(value)) return "srt"; if (/\.ass\b/.test(value)) return "ass"; if (/\.ssa\b/.test(value)) return "ssa"; if (/\.sub\b/.test(value)) return "sub"; if (/\.txt\b/.test(value)) return "txt"; return "srt"; }
