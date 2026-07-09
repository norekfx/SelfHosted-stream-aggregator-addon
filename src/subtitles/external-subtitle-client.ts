import { z } from "zod";
import { listAddons } from "../addons/addon-registry.js";
import type { RegisteredAddon } from "../addons/types.js";
import { getAppSettings } from "../settings/app-settings.js";
import type { StreamType } from "../streams/types.js";
import { writeSystemLog } from "../system/system-log.js";
import { buildSubtitlesUrl, isAnimeSubAddon, type AnimeSubSubtitleFetchResult, type ExternalSubtitle } from "./animesub-client.js";
import { matchesSubtitleLanguage } from "./subtitle-language.js";

const externalSubtitleSchema = z.object({
  id: z.string().optional(),
  lang: z.string().optional(),
  url: z.string().url().optional(),
  name: z.string().optional()
}).passthrough();

const subtitleResponseSchema = z.object({
  subtitles: z.array(externalSubtitleSchema).default([])
}).passthrough();

export async function fetchExternalAddonSubtitles(type: StreamType, id: string, timeoutMs = 12000): Promise<AnimeSubSubtitleFetchResult[]> {
  const settings = getAppSettings();
  if (!settings.forwardExternalSubtitles) {
    writeSystemLog("info", "subtitles", "External subtitle forwarding is disabled.", { type, id });
    return [];
  }

  const addons = listAddons().filter(isExternalSubtitleAddonEnabled);
  if (!addons.length) {
    writeSystemLog("warn", "subtitles", "External subtitle fetch skipped because no enabled online non-AnimeSub subtitle addon was found.", { type, id });
    return [];
  }

  writeSystemLog("info", "subtitles", "External subtitle fetch started.", { type, id, addonCount: addons.length, mode: settings.forwardedSubtitleMode, language: settings.forwardedSubtitleLanguage });
  const results = await Promise.all(addons.map((addon) => fetchAddonSubtitles(addon, type, id, timeoutMs)));
  const filtered = results.map((result) => ({ ...result, subtitles: filterSubtitlesBySettings(result.subtitles) }));

  writeSystemLog("info", "subtitles", "External subtitle fetch completed.", {
    type,
    id,
    addonCount: addons.length,
    fulfilled: filtered.filter((result) => result.status === "fulfilled").length,
    rejected: filtered.filter((result) => result.status === "rejected").length,
    subtitleCount: filtered.reduce((sum, result) => sum + result.subtitles.length, 0),
    mode: settings.forwardedSubtitleMode,
    language: settings.forwardedSubtitleLanguage
  });

  return filtered;
}

function isExternalSubtitleAddonEnabled(addon: RegisteredAddon): boolean {
  return addon.enabled && addon.status === "online" && addon.supportedResources.includes("subtitles") && !isAnimeSubAddon(addon);
}

async function fetchAddonSubtitles(addon: RegisteredAddon, type: StreamType, id: string, timeoutMs: number): Promise<AnimeSubSubtitleFetchResult> {
  const requestUrl = buildSubtitlesUrl(addon.manifestUrl, type, id);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  writeSystemLog("info", "subtitles", "External subtitle request sent.", { addonId: addon.id, addonName: addon.name, manifestUrl: addon.manifestUrl, type, id, requestUrl });

  try {
    const response = await fetch(requestUrl, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Subtitle request failed with HTTP ${response.status}.`);
    const json = await response.json();
    const parsed = subtitleResponseSchema.parse(json);
    const normalizedSubtitles = parsed.subtitles.map((subtitle) => normalizeExternalSubtitleUrl(subtitle, requestUrl)).filter((subtitle) => subtitle.url);
    const subtitles = dedupeSubtitles(normalizedSubtitles);
    writeSystemLog(subtitles.length > 0 ? "info" : "warn", "subtitles", "External subtitle response received.", {
      addonId: addon.id,
      addonName: addon.name,
      type,
      id,
      requestUrl,
      responseTimeMs: Date.now() - startedAt,
      subtitleCount: subtitles.length,
      subtitles: subtitles.slice(0, 20).map(toSubtitleLogSample)
    });
    return { addon, sourceKind: "external", status: "fulfilled", responseTimeMs: Date.now() - startedAt, subtitles, requestUrl };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? `Subtitle request timed out after ${timeoutMs}ms.` : error instanceof Error ? error.message : "Unknown subtitle request error.";
    writeSystemLog("warn", "subtitles", "External subtitle request failed.", { addonId: addon.id, addonName: addon.name, type, id, requestUrl, responseTimeMs: Date.now() - startedAt, error: message });
    return { addon, sourceKind: "external", status: "rejected", responseTimeMs: Date.now() - startedAt, subtitles: [], error: message, requestUrl };
  } finally {
    clearTimeout(timeout);
  }
}

function filterSubtitlesBySettings(subtitles: ExternalSubtitle[]): ExternalSubtitle[] {
  const settings = getAppSettings();
  if (settings.forwardedSubtitleMode === "all") return subtitles;
  return subtitles.filter((subtitle) => matchesSubtitleLanguage(subtitle, settings.forwardedSubtitleLanguage));
}

function normalizeExternalSubtitleUrl(subtitle: ExternalSubtitle, requestUrl: string): ExternalSubtitle {
  if (!subtitle.url) return subtitle;
  const normalizedUrl = normalizeLocalhostUrl(subtitle.url, requestUrl);
  if (normalizedUrl === subtitle.url) return subtitle;
  return { ...subtitle, url: normalizedUrl, originalUrl: subtitle.url } as ExternalSubtitle;
}

function normalizeLocalhostUrl(rawUrl: string, addonRequestUrl: string): string {
  try {
    const subtitleUrl = new URL(rawUrl);
    if (!isLocalhostHost(subtitleUrl.hostname)) return rawUrl;
    const addonUrl = new URL(addonRequestUrl);
    subtitleUrl.protocol = addonUrl.protocol;
    subtitleUrl.hostname = addonUrl.hostname;
    subtitleUrl.port = addonUrl.port;
    return subtitleUrl.toString();
  } catch {
    return rawUrl;
  }
}

function isLocalhostHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1" || hostname === "[::1]";
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
    url: subtitle.url,
    originalUrl: (subtitle as ExternalSubtitle & { originalUrl?: string }).originalUrl
  };
}
