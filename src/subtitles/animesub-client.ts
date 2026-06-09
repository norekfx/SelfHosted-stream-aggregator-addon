import { z } from "zod";
import { listAddons } from "../addons/addon-registry.js";
import type { RegisteredAddon } from "../addons/types.js";
import { writeSystemLog } from "../system/system-log.js";
import type { StreamType } from "../streams/types.js";

const externalSubtitleSchema = z.object({
  id: z.string().optional(),
  lang: z.string().optional(),
  url: z.string().url().optional(),
  name: z.string().optional()
}).passthrough();

const subtitleResponseSchema = z.object({
  subtitles: z.array(externalSubtitleSchema).default([])
}).passthrough();

export type ExternalSubtitle = z.infer<typeof externalSubtitleSchema>;

export type AnimeSubSubtitleFetchResult = {
  addon: RegisteredAddon;
  status: "fulfilled" | "rejected";
  responseTimeMs: number;
  subtitles: ExternalSubtitle[];
  error?: string;
  requestUrl: string;
};

export function isAnimeSubAddon(addon: { name?: string; manifestUrl: string; description?: string }): boolean {
  const manifestText = `${addon.name ?? ""} ${addon.description ?? ""}`;
  if (/anime\s*sub|animesub/i.test(manifestText)) return true;

  try {
    const hostname = new URL(addon.manifestUrl).hostname;
    return /(^|\.)(animesub\.info)$/i.test(hostname) || /animesub/i.test(hostname);
  } catch {
    return false;
  }
}

export function getEnabledAnimeSubAddons(): RegisteredAddon[] {
  return listAddons().filter((addon) => addon.enabled && addon.status === "online" && addon.supportedResources.includes("subtitles") && isAnimeSubAddon(addon));
}

export async function fetchAnimeSubSubtitles(type: StreamType, id: string, timeoutMs = 12000): Promise<AnimeSubSubtitleFetchResult[]> {
  const addons = getEnabledAnimeSubAddons();
  if (!addons.length) {
    writeSystemLog("warn", "animesub", "AnimeSub subtitle fetch skipped because no enabled online AnimeSub subtitle addon was found.", { type, id });
    return [];
  }

  writeSystemLog("info", "animesub", "AnimeSub subtitle fetch started.", { type, id, addonCount: addons.length });
  const results = await Promise.all(addons.map((addon) => fetchAddonSubtitles(addon, type, id, timeoutMs)));
  writeSystemLog("info", "animesub", "AnimeSub subtitle fetch completed.", {
    type,
    id,
    addonCount: addons.length,
    fulfilled: results.filter((result) => result.status === "fulfilled").length,
    rejected: results.filter((result) => result.status === "rejected").length,
    subtitleCount: results.reduce((sum, result) => sum + result.subtitles.length, 0)
  });
  return results;
}

async function fetchAddonSubtitles(addon: RegisteredAddon, type: StreamType, id: string, timeoutMs: number): Promise<AnimeSubSubtitleFetchResult> {
  const requestUrl = buildSubtitlesUrl(addon.manifestUrl, type, id);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  writeSystemLog("info", "animesub", "AnimeSub subtitle request sent.", { addonId: addon.id, addonName: addon.name, manifestUrl: addon.manifestUrl, type, id, requestUrl });

  try {
    const response = await fetch(requestUrl, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Subtitle request failed with HTTP ${response.status}.`);
    const json = await response.json();
    const parsed = subtitleResponseSchema.parse(json);
    const subtitles = dedupeSubtitles(parsed.subtitles);
    writeSystemLog(subtitles.length > 0 ? "info" : "warn", "animesub", "AnimeSub subtitle response received.", {
      addonId: addon.id,
      addonName: addon.name,
      type,
      id,
      requestUrl,
      responseTimeMs: Date.now() - startedAt,
      subtitleCount: subtitles.length,
      subtitles: subtitles.slice(0, 20).map(toSubtitleLogSample)
    });
    return { addon, status: "fulfilled", responseTimeMs: Date.now() - startedAt, subtitles, requestUrl };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? `Subtitle request timed out after ${timeoutMs}ms.` : error instanceof Error ? error.message : "Unknown subtitle request error.";
    writeSystemLog("warn", "animesub", "AnimeSub subtitle request failed.", { addonId: addon.id, addonName: addon.name, type, id, requestUrl, responseTimeMs: Date.now() - startedAt, error: message });
    return { addon, status: "rejected", responseTimeMs: Date.now() - startedAt, subtitles: [], error: message, requestUrl };
  } finally {
    clearTimeout(timeout);
  }
}

export function buildSubtitlesUrl(manifestUrl: string, type: StreamType, id: string): string {
  const url = new URL(manifestUrl);
  const encodedType = encodeURIComponent(type);
  const encodedId = encodeURIComponent(id).replace(/%3A/gi, ":");
  url.pathname = url.pathname.replace(/\/manifest\.json$/, `/subtitles/${encodedType}/${encodedId}.json`);
  return url.toString();
}

function dedupeSubtitles(subtitles: ExternalSubtitle[]): ExternalSubtitle[] {
  const seen = new Set<string>();
  const result: ExternalSubtitle[] = [];
  for (const subtitle of subtitles) {
    const key = `${subtitle.lang ?? ""}|${subtitle.id ?? ""}|${subtitle.url ?? ""}|${subtitle.name ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(subtitle);
  }
  return result;
}

function toSubtitleLogSample(subtitle: ExternalSubtitle): Record<string, unknown> {
  return {
    id: subtitle.id,
    lang: subtitle.lang,
    name: subtitle.name,
    url: subtitle.url
  };
}
