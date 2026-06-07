import { fetchAddonStreams, buildStreamUrl, type AddonStreamFetchResult } from "../addons/addon-stream-client.js";
import { listAddons } from "../addons/addon-registry.js";
import type { RegisteredAddon } from "../addons/types.js";
import { getAppSettings } from "../settings/app-settings.js";
import { writeSystemLog } from "../system/system-log.js";
import type { StreamType } from "../streams/types.js";
import { fetchTmdbMeta } from "../tmdb/tmdb-client.js";

export type DocchiEpisodeFix = {
  originalId: string;
  mappedId: string;
  fixed: boolean;
  forced?: boolean;
  triedIds: string[];
  addonName?: string;
  streamCount: number;
  docchiId?: string;
  docchiTitle?: string;
  docchiEpisodeCount?: number;
  mappedSeason?: number;
  mappedEpisode?: number;
  seasonCandidateIndex?: number;
};

type DocchiMetaPreview = { id?: string; name?: string; type?: string; releaseInfo?: string };
type DocchiResolvedAnime = { id: string; name?: string; releaseInfo?: string; year?: number; seasonHint?: number; episodeCount: number; videos: Array<{ id?: string; title?: string; episode?: number }> };
type InferredEpisode = { season: number; episode: number; absoluteEpisode: number; releaseYear?: number; seasonEpisodeCount?: number };

const cache = new Map<string, DocchiEpisodeFix>();
const searchCache = new Map<string, DocchiMetaPreview[]>();
const metaCache = new Map<string, DocchiResolvedAnime | null>();
const seriesResolutionCache = new Map<string, DocchiResolvedAnime[]>();

export function isDocchiAddon(addon: { name?: string; manifestUrl: string; description?: string }): boolean {
  return /docc?h?i/i.test(`${addon.name ?? ""} ${addon.description ?? ""} ${addon.manifestUrl}`);
}

export function getEnabledDocchiAddons(): RegisteredAddon[] {
  return listAddons().filter((addon) => addon.enabled && addon.status === "online" && addon.supportedResources.includes("stream") && isDocchiAddon(addon));
}

export async function fetchDocchiFixedStreams(type: StreamType, id: string): Promise<AddonStreamFetchResult[]> {
  if (type !== "series" || !isDocchiMappingGloballyEnabled()) return [];
  const parsed = parseEpisodeId(id);
  if (!parsed) return [];

  const docchiAddons = getEnabledDocchiAddons();
  if (!docchiAddons.length) return [];

  const result = await findDocchiEpisodeFix(id, { addons: docchiAddons, force: false });
  if (!result.fixed || !result.docchiId) return [];

  writeSystemLog("info", "docchi", "Docchi fixed episode index for stream aggregation.", {
    originalId: result.originalId,
    mappedId: result.mappedId,
    mappedSeason: result.mappedSeason,
    mappedEpisode: result.mappedEpisode,
    docchiId: result.docchiId,
    addonName: result.addonName,
    streamCount: result.streamCount,
    docchiEpisodeCount: result.docchiEpisodeCount
  });

  return Promise.all(docchiAddons.map((addon) => fetchAddonStreamsWithLog(addon, "anime", result.docchiId ?? result.mappedId, "fixed-stream-fetch")));
}

export async function findDocchiEpisodeFix(originalId: string, options: { addons?: RegisteredAddon[]; force?: boolean } = {}): Promise<DocchiEpisodeFix> {
  const forced = options.force === true || options.addons === undefined;
  const cached = cache.get(originalId);
  if (cached && !forced) return cached;

  const addons = options.addons ?? getEnabledDocchiAddons();
  const parsed = parseEpisodeId(originalId);
  const fallback: DocchiEpisodeFix = { originalId, mappedId: originalId, fixed: false, forced, triedIds: [], streamCount: 0 };
  if (!parsed || !addons.length || (!forced && !isDocchiMappingGloballyEnabled())) return fallback;

  const tmdbMeta = await fetchTmdbMeta("series", parsed.seriesId).catch(() => null);
  const inferred = inferSeasonEpisode(tmdbMeta, parsed.episode) ?? { season: parsed.season, episode: parsed.episode, absoluteEpisode: parsed.episode };
  const searchTerms = buildSearchTerms(tmdbMeta?.name ?? parsed.seriesId);
  const triedIds: string[] = [];

  writeSystemLog("info", "docchi", forced ? "Docchi force mapping started." : "Docchi mapping probe started.", { originalId, inferred, searchTerms, addonCount: addons.length, forced });

  for (const addon of addons) {
    const resolved = await resolveDocchiAnime(addon, parsed.seriesId, searchTerms, forced ? 12 : 8);
    const preferredAnime = chooseAnimeCandidatesForSeason(resolved, inferred);
    for (const candidate of preferredAnime) {
      const anime = candidate.anime;
      const episodeCandidates = generateEpisodeCandidates(inferred.episode, forced, anime.episodeCount);
      writeSystemLog("info", "docchi", "Docchi candidate anime selected.", {
        originalId,
        animeId: anime.id,
        animeName: anime.name,
        animeYear: anime.year,
        seasonHint: anime.seasonHint,
        inferredSeason: inferred.season,
        inferredEpisode: inferred.episode,
        releaseYear: inferred.releaseYear,
        candidateIndex: candidate.index,
        candidateScore: candidate.score,
        episodeCount: anime.episodeCount,
        episodeCandidates
      });
      for (const episode of episodeCandidates) {
        const docchiStreamId = `${anime.id}:${episode}`;
        triedIds.push(docchiStreamId);
        const response = await fetchAddonStreamsWithLog(addon, "anime", docchiStreamId, forced ? "force-season-guided-probe" : "season-guided-probe");
        if (response.status === "fulfilled" && response.streams.length > 0) {
          const mappedId = `${parsed.seriesId}:${inferred.season}:${episode}`;
          const fix: DocchiEpisodeFix = {
            originalId,
            mappedId,
            fixed: mappedId !== originalId || docchiStreamId !== originalId,
            forced,
            triedIds,
            addonName: addon.name,
            streamCount: response.streams.length,
            docchiId: docchiStreamId,
            docchiTitle: anime.name,
            docchiEpisodeCount: anime.episodeCount,
            mappedSeason: inferred.season,
            mappedEpisode: episode,
            seasonCandidateIndex: candidate.index
          };
          cache.set(originalId, fix);
          writeSystemLog("info", "docchi", forced ? "Docchi force mapping found streams." : "Docchi mapping found streams.", fix);
          return fix;
        }
      }
    }
  }

  const miss = { ...fallback, triedIds, mappedSeason: inferred.season, mappedEpisode: inferred.episode };
  cache.set(originalId, miss);
  writeSystemLog("warn", "docchi", forced ? "Docchi force mapping did not find streams." : "Docchi mapping did not find streams.", miss);
  return miss;
}

export async function forceDocchiEpisodeFixes(ids: string[]): Promise<DocchiEpisodeFix[]> {
  const addons = getEnabledDocchiAddons();
  const uniqueIds = Array.from(new Set(ids.filter((id) => /^tt\d+:\d+:\d+$/i.test(id)))).slice(0, 120);
  writeSystemLog("info", "docchi", "Docchi force scan requested from WebUI.", { requestedIds: ids.length, uniqueIds: uniqueIds.length, addonCount: addons.length });
  const fixes: DocchiEpisodeFix[] = [];
  for (const id of uniqueIds) fixes.push(await findDocchiEpisodeFix(id, { addons, force: true }));
  writeSystemLog("info", "docchi", "Docchi force scan finished.", {
    checked: fixes.length,
    fixed: fixes.filter((fix) => fix.fixed).length,
    ids: fixes.map((fix) => ({ originalId: fix.originalId, mappedId: fix.mappedId, docchiId: fix.docchiId, fixed: fix.fixed, streamCount: fix.streamCount }))
  });
  return fixes;
}

async function resolveDocchiAnime(addon: RegisteredAddon, seriesId: string, searchTerms: string[], limit: number): Promise<DocchiResolvedAnime[]> {
  const cacheKey = `${addon.manifestUrl}|${seriesId}|${searchTerms.join("|")}|${limit}`;
  const cached = seriesResolutionCache.get(cacheKey);
  if (cached) return cached;

  const previews = await searchDocchiAnime(addon, searchTerms, limit);
  const resolved: DocchiResolvedAnime[] = [];
  for (const preview of previews) {
    const id = normalizeDocchiMetaId(preview.id);
    if (!id) continue;
    const full = await fetchDocchiMeta(addon, id, preview.name, preview.releaseInfo);
    if (full && full.episodeCount > 0) resolved.push(full);
  }

  const sorted = sortResolvedAnime(resolved);
  seriesResolutionCache.set(cacheKey, sorted);
  writeSystemLog("info", "docchi", "Docchi anime resolution finished.", {
    seriesId,
    searchTerms,
    resolved: sorted.map((item, index) => ({ index: index + 1, id: item.id, name: item.name, year: item.year, seasonHint: item.seasonHint, episodeCount: item.episodeCount }))
  });
  return sorted;
}

async function searchDocchiAnime(addon: RegisteredAddon, searchTerms: string[], limit: number): Promise<DocchiMetaPreview[]> {
  const results: DocchiMetaPreview[] = [];
  const seen = new Set<string>();
  for (const term of searchTerms) {
    const key = `${addon.manifestUrl}|${term}`;
    const cached = searchCache.get(key);
    const metas = cached ?? await fetchDocchiSearch(addon, term);
    if (!cached) searchCache.set(key, metas);
    for (const meta of metas) {
      const id = normalizeDocchiMetaId(meta.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      results.push(meta);
      if (results.length >= limit) return results;
    }
  }
  return results;
}

async function fetchDocchiSearch(addon: RegisteredAddon, term: string): Promise<DocchiMetaPreview[]> {
  const url = buildCatalogSearchUrl(addon.manifestUrl, term);
  writeSystemLog("info", "docchi", "Docchi catalog search request sent.", { addonId: addon.id, addonName: addon.name, manifestUrl: addon.manifestUrl, requestUrl: url, search: term });
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Docchi catalog search failed with HTTP ${response.status}.`);
    const json = await response.json() as { metas?: DocchiMetaPreview[] };
    const metas = Array.isArray(json.metas) ? json.metas : [];
    writeSystemLog("info", "docchi", "Docchi catalog search response received.", {
      addonId: addon.id,
      addonName: addon.name,
      search: term,
      responseTimeMs: Date.now() - startedAt,
      metaCount: metas.length,
      metas: metas.slice(0, 10).map((meta) => ({ id: meta.id, name: meta.name, type: meta.type, releaseInfo: meta.releaseInfo }))
    });
    return metas;
  } catch (error) {
    writeSystemLog("warn", "docchi", "Docchi catalog search failed.", { addonId: addon.id, addonName: addon.name, search: term, responseTimeMs: Date.now() - startedAt, error: error instanceof Error ? error.message : "Unknown error" });
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDocchiMeta(addon: RegisteredAddon, id: string, fallbackName?: string, releaseInfo?: string): Promise<DocchiResolvedAnime | null> {
  const cacheKey = `${addon.manifestUrl}|${id}`;
  if (metaCache.has(cacheKey)) return metaCache.get(cacheKey) ?? null;
  const url = buildMetaUrl(addon.manifestUrl, id);
  writeSystemLog("info", "docchi", "Docchi meta request sent.", { addonId: addon.id, addonName: addon.name, manifestUrl: addon.manifestUrl, requestUrl: url, id });
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Docchi meta failed with HTTP ${response.status}.`);
    const json = await response.json() as { meta?: { id?: string; name?: string; releaseInfo?: string; videos?: Array<{ id?: string; title?: string; episode?: number }> } };
    const videos = Array.isArray(json.meta?.videos) ? json.meta.videos : [];
    const name = json.meta?.name ?? fallbackName;
    const mergedReleaseInfo = json.meta?.releaseInfo ?? releaseInfo;
    const resolved: DocchiResolvedAnime = { id, name, releaseInfo: mergedReleaseInfo, year: extractYear(`${mergedReleaseInfo ?? ""} ${name ?? ""}`), seasonHint: extractSeasonHint(name), videos, episodeCount: videos.length };
    metaCache.set(cacheKey, resolved);
    writeSystemLog("info", "docchi", "Docchi meta response received.", { addonId: addon.id, addonName: addon.name, id, responseTimeMs: Date.now() - startedAt, name: resolved.name, releaseInfo: resolved.releaseInfo, year: resolved.year, seasonHint: resolved.seasonHint, episodeCount: resolved.episodeCount, sampleVideos: videos.slice(0, 5).map((video) => ({ id: video.id, title: video.title, episode: video.episode })) });
    return resolved;
  } catch (error) {
    metaCache.set(cacheKey, null);
    writeSystemLog("warn", "docchi", "Docchi meta failed.", { addonId: addon.id, addonName: addon.name, id, responseTimeMs: Date.now() - startedAt, error: error instanceof Error ? error.message : "Unknown error" });
    return null;
  }
}

async function fetchAddonStreamsWithLog(addon: RegisteredAddon, type: StreamType | "anime", id: string, phase: string): Promise<AddonStreamFetchResult> {
  const url = buildStreamUrl(addon.manifestUrl, type as StreamType, id);
  writeSystemLog("info", "docchi", "Docchi request sent.", { phase, addonId: addon.id, addonName: addon.name, manifestUrl: addon.manifestUrl, requestUrl: url, type, id });
  const result = await fetchAddonStreams(addon, type as StreamType, id);
  writeSystemLog(result.status === "fulfilled" ? "info" : "warn", "docchi", "Docchi response received.", { phase, addonId: addon.id, addonName: addon.name, type, id, status: result.status, responseTimeMs: result.responseTimeMs, streamCount: result.streams.length, error: result.error });
  return result;
}

function buildCatalogSearchUrl(manifestUrl: string, search: string): string {
  const url = new URL(manifestUrl);
  url.pathname = url.pathname.replace(/\/manifest\.json$/, `/catalog/anime/search_list/search=${encodeURIComponent(search)}.json`);
  return url.toString();
}

function buildMetaUrl(manifestUrl: string, id: string): string {
  const url = new URL(manifestUrl);
  url.pathname = url.pathname.replace(/\/manifest\.json$/, `/meta/anime/${encodeURIComponent(id)}.json`);
  return url.toString();
}

function buildSearchTerms(title: string): string[] {
  const clean = title.replace(/\([^)]*\)/g, " ").replace(/\b(?:season|sezon|part|cour|arc)\s*\d+\b/gi, " ").replace(/[:–—-]+/g, " ").replace(/\s+/g, " ").trim();
  const terms = [title, clean];
  const splitTitle = title.split(/[:–—-]/)[0]?.trim();
  if (splitTitle) terms.push(splitTitle);
  const words = clean.split(/\s+/).filter(Boolean);
  for (let length = words.length - 1; length >= 1; length -= 1) terms.push(words.slice(0, length).join(" "));
  return Array.from(new Set(terms.map((term) => term.trim()).filter((term) => term.length >= 3))).slice(0, 8);
}

function chooseAnimeCandidatesForSeason(resolved: DocchiResolvedAnime[], inferred: InferredEpisode): Array<{ anime: DocchiResolvedAnime; index: number; score: number }> {
  if (!resolved.length) return [];
  const scored = resolved.map((anime, index) => {
    let score = 0;
    if (anime.seasonHint === inferred.season) score += 500;
    if (anime.year && inferred.releaseYear && Math.abs(anime.year - inferred.releaseYear) <= 1) score += 300;
    if (inferred.season === 1 && (anime.seasonHint ?? 1) === 1) score += 120;
    if (anime.episodeCount >= inferred.episode) score += 80;
    score -= Math.abs(index + 1 - inferred.season) * 25;
    return { anime, index: index + 1, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function sortResolvedAnime(items: DocchiResolvedAnime[]): DocchiResolvedAnime[] {
  return [...items].sort((a, b) => {
    const seasonDelta = (a.seasonHint ?? 999) - (b.seasonHint ?? 999);
    if (seasonDelta !== 0) return seasonDelta;
    const yearDelta = (a.year ?? 9999) - (b.year ?? 9999);
    if (yearDelta !== 0) return yearDelta;
    return 0;
  });
}

function inferSeasonEpisode(tmdbMeta: { videos?: Array<{ season?: number; episode?: number; released?: string }> } | null | undefined, absoluteEpisode: number): InferredEpisode | undefined {
  const videos = (tmdbMeta?.videos ?? []).filter((video) => Number.isFinite(video.episode) && video.episode! > 0).sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
  if (!videos.length) return undefined;
  let currentSeason = 1;
  let currentEpisode = 0;
  let lastReleased: Date | undefined;
  for (const video of videos) {
    const released = video.released ? new Date(video.released) : undefined;
    if (lastReleased && released && Number.isFinite(released.getTime())) {
      const gapDays = Math.floor((released.getTime() - lastReleased.getTime()) / 86_400_000);
      if (gapDays >= 120) {
        currentSeason += 1;
        currentEpisode = 0;
      }
    }
    currentEpisode += 1;
    if (video.episode === absoluteEpisode) {
      return { season: currentSeason, episode: currentEpisode, absoluteEpisode, releaseYear: released && Number.isFinite(released.getTime()) ? released.getUTCFullYear() : undefined };
    }
    if (released && Number.isFinite(released.getTime())) lastReleased = released;
  }
  return undefined;
}

function extractYear(value?: string): number | undefined {
  const year = value?.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
  return year ? Number.parseInt(year, 10) : undefined;
}

function extractSeasonHint(name?: string): number | undefined {
  if (!name) return undefined;
  const sMatch = name.match(/\bS(?:eason)?\s*(\d+)\b/i) ?? name.match(/\b(?:season|sezon)\s*(\d+)\b/i);
  if (sMatch?.[1]) return Number.parseInt(sMatch[1], 10);
  const partMatch = name.match(/\b(?:part|cour)\s*(\d+)\b/i);
  if (partMatch?.[1]) return Number.parseInt(partMatch[1], 10);
  return undefined;
}

function normalizeDocchiMetaId(id?: string): string | undefined {
  const match = id?.match(/^(mal|kitsu):(\d+)$/i);
  return match ? `${match[1]?.toLowerCase()}:${match[2]}` : undefined;
}

function isDocchiMappingGloballyEnabled(): boolean {
  return getAppSettings().docchiPublicMappingMode !== "disabled";
}

function parseEpisodeId(id: string): { seriesId: string; season: number; episode: number } | undefined {
  const match = id.match(/^(tt\d+):(\d+):(\d+)$/i);
  if (!match) return undefined;
  const season = Number.parseInt(match[2] ?? "0", 10);
  const episode = Number.parseInt(match[3] ?? "0", 10);
  if (!season || !episode) return undefined;
  return { seriesId: match[1] ?? "", season, episode };
}

function generateEpisodeCandidates(episode: number, forced = false, episodeCount = 0): number[] {
  const candidates = new Set<number>();
  candidates.add(episode);
  if (forced) {
    candidates.add(episode - 1);
    candidates.add(episode + 1);
    candidates.add(episode - 2);
    candidates.add(episode + 2);
  }
  return Array.from(candidates).filter((value) => value > 0 && (!episodeCount || value <= episodeCount)).slice(0, forced ? 5 : 1);
}
