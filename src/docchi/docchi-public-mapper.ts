import { fetchAddonStreams, buildStreamUrl, type AddonStreamFetchResult } from "../addons/addon-stream-client.js";
import { listAddons } from "../addons/addon-registry.js";
import type { RegisteredAddon } from "../addons/types.js";
import { getAppSettings } from "../settings/app-settings.js";
import { writeSystemLog } from "../system/system-log.js";
import type { StreamType } from "../streams/types.js";
import { fetchTmdbMeta } from "../tmdb/tmdb-client.js";
import { saveDocchiEpisodeMappingFromFix } from "./docchi-episode-mapping-store.js";

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
  matchMethod?: string;
  confidence?: number;
};

type DocchiMetaPreview = { id?: string; name?: string; type?: string; releaseInfo?: string };
type DocchiVideo = { id?: string; title?: string; episode?: number; released?: string; overview?: string; available?: boolean; season?: number };
type DocchiResolvedAnime = { id: string; name?: string; releaseInfo?: string; year?: number; seasonHint?: number; episodeCount: number; videos: DocchiVideo[] };
type TmdbEpisode = { title?: string; released?: string; season?: number; episode?: number };
type DocchiPlanRow = {
  docchiId: string;
  docchiTitle?: string;
  docchiAnimeId: string;
  docchiAnimeName?: string;
  released?: string;
  absoluteIndex: number;
  season: number;
  episode: number;
  sourceEpisode?: number;
};
type DocchiSeriesPlan = { rows: DocchiPlanRow[]; anime: DocchiResolvedAnime[] };

const cache = new Map<string, DocchiEpisodeFix>();
const searchCache = new Map<string, DocchiMetaPreview[]>();
const metaCache = new Map<string, DocchiResolvedAnime | null>();
const planCache = new Map<string, DocchiSeriesPlan>();

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
  const docchiId = result.docchiId;
  if (!result.fixed || !docchiId) return [];

  writeSystemLog("info", "docchi", "Docchi fixed episode index for stream aggregation.", {
    originalId: result.originalId,
    mappedId: result.mappedId,
    mappedSeason: result.mappedSeason,
    mappedEpisode: result.mappedEpisode,
    docchiId,
    matchMethod: result.matchMethod,
    confidence: result.confidence
  });

  return Promise.all(docchiAddons.map((addon) => fetchAddonStreamsWithLog(addon, "anime", docchiId, "planned-fixed-stream-fetch")));
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
  const sourceEpisode = findTmdbEpisode(tmdbMeta?.videos, parsed.season, parsed.episode);
  const searchTerms = buildSearchTerms(tmdbMeta?.name ?? parsed.seriesId);

  writeSystemLog("info", "docchi", forced ? "Docchi force plan mapping started." : "Docchi plan mapping started.", {
    originalId,
    sourceEpisode,
    searchTerms,
    addonCount: addons.length,
    forced
  });

  for (const addon of addons) {
    const plan = await buildDocchiSeriesPlan(addon, parsed.seriesId, searchTerms, forced ? 16 : 10);
    const match = choosePlanRow(plan.rows, parsed, sourceEpisode);
    writeSystemLog(match ? "info" : "warn", "docchi", "Docchi plan match result.", {
      originalId,
      planRows: plan.rows.length,
      anime: plan.anime.map((item) => ({ id: item.id, name: item.name, episodeCount: item.episodeCount, year: item.year, seasonHint: item.seasonHint })),
      match: match ? { docchiId: match.row.docchiId, title: match.row.docchiTitle, season: match.row.season, episode: match.row.episode, method: match.method, confidence: match.confidence } : undefined
    });
    if (!match) continue;

    const mappedId = `${parsed.seriesId}:${match.row.season}:${match.row.episode}`;
    const fix: DocchiEpisodeFix = {
      originalId,
      mappedId,
      fixed: mappedId !== originalId || match.row.docchiId !== originalId,
      forced,
      triedIds: [match.row.docchiId],
      addonName: addon.name,
      streamCount: 0,
      docchiId: match.row.docchiId,
      docchiTitle: match.row.docchiTitle,
      docchiEpisodeCount: plan.rows.length,
      mappedSeason: match.row.season,
      mappedEpisode: match.row.episode,
      matchMethod: match.method,
      confidence: match.confidence
    };
    cache.set(originalId, fix);
    saveDocchiEpisodeMappingFromFix(fix);
    return fix;
  }

  const miss = { ...fallback, triedIds: [] };
  cache.set(originalId, miss);
  writeSystemLog("warn", "docchi", forced ? "Docchi force plan mapping did not find a match." : "Docchi plan mapping did not find a match.", miss);
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
    ids: fixes.map((fix) => ({ originalId: fix.originalId, mappedId: fix.mappedId, docchiId: fix.docchiId, fixed: fix.fixed, method: fix.matchMethod, confidence: fix.confidence }))
  });
  return fixes;
}

async function buildDocchiSeriesPlan(addon: RegisteredAddon, seriesId: string, searchTerms: string[], limit: number): Promise<DocchiSeriesPlan> {
  const cacheKey = `${addon.manifestUrl}|${seriesId}|${searchTerms.join("|")}|${limit}`;
  const cached = planCache.get(cacheKey);
  if (cached) return cached;

  const anime = await resolveDocchiAnime(addon, seriesId, searchTerms, limit);
  const rows = buildPlanRows(anime);
  const plan = { rows, anime };
  planCache.set(cacheKey, plan);
  writeSystemLog("info", "docchi", "Docchi series episode plan built.", {
    seriesId,
    searchTerms,
    animeCount: anime.length,
    rowCount: rows.length,
    seasons: summarizePlanSeasons(rows),
    sampleRows: rows.slice(0, 12).map((row) => ({ docchiId: row.docchiId, title: row.docchiTitle, released: row.released, season: row.season, episode: row.episode, absoluteIndex: row.absoluteIndex }))
  });
  return plan;
}

async function resolveDocchiAnime(addon: RegisteredAddon, seriesId: string, searchTerms: string[], limit: number): Promise<DocchiResolvedAnime[]> {
  const previews = await searchDocchiAnime(addon, searchTerms, limit);
  const resolved: DocchiResolvedAnime[] = [];
  for (const preview of previews) {
    const id = normalizeDocchiMetaId(preview.id);
    if (!id) continue;
    const full = await fetchDocchiMeta(addon, id, preview.name, preview.releaseInfo);
    if (full && full.episodeCount > 1) resolved.push(full);
  }
  return sortResolvedAnime(resolved);
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
    writeSystemLog("info", "docchi", "Docchi catalog search response received.", { addonId: addon.id, addonName: addon.name, search: term, responseTimeMs: Date.now() - startedAt, metaCount: metas.length, metas: metas.slice(0, 10).map((meta) => ({ id: meta.id, name: meta.name, type: meta.type, releaseInfo: meta.releaseInfo })) });
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
    const json = await response.json() as { meta?: { id?: string; name?: string; releaseInfo?: string; videos?: DocchiVideo[] } };
    const videos = Array.isArray(json.meta?.videos) ? json.meta.videos : [];
    const name = json.meta?.name ?? fallbackName;
    const mergedReleaseInfo = json.meta?.releaseInfo ?? releaseInfo;
    const resolved: DocchiResolvedAnime = { id, name, releaseInfo: mergedReleaseInfo, year: extractYear(`${mergedReleaseInfo ?? ""} ${name ?? ""}`), seasonHint: extractSeasonHint(name), videos, episodeCount: videos.length };
    metaCache.set(cacheKey, resolved);
    writeSystemLog("info", "docchi", "Docchi meta response received.", { addonId: addon.id, addonName: addon.name, id, responseTimeMs: Date.now() - startedAt, name: resolved.name, releaseInfo: resolved.releaseInfo, year: resolved.year, seasonHint: resolved.seasonHint, episodeCount: resolved.episodeCount, sampleVideos: videos.slice(0, 6).map((video) => ({ id: video.id, title: video.title, episode: video.episode, released: video.released, season: video.season })) });
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

function buildPlanRows(anime: DocchiResolvedAnime[]): DocchiPlanRow[] {
  const rawRows = anime.flatMap((item) => item.videos.map((video, index) => toPlanRow(item, video, index + 1))).filter(Boolean) as DocchiPlanRow[];
  const deduped = dedupePlanRows(rawRows);
  deduped.sort((a, b) => compareRowsByDateOrIndex(a, b));

  let season = 1;
  let episode = 0;
  let lastDate: Date | undefined;
  for (let index = 0; index < deduped.length; index += 1) {
    const row = deduped[index];
    if (!row) continue;
    const date = parseDate(row.released);
    if (lastDate && date) {
      const gapDays = Math.floor((date.getTime() - lastDate.getTime()) / 86_400_000);
      if (gapDays >= 120) {
        season += 1;
        episode = 0;
      }
    }
    episode += 1;
    row.absoluteIndex = index + 1;
    row.season = row.season > 0 ? row.season : season;
    row.episode = row.episode > 0 && row.season === season ? row.episode : episode;
    if (date) lastDate = date;
  }
  return deduped;
}

function toPlanRow(anime: DocchiResolvedAnime, video: DocchiVideo, fallbackEpisode: number): DocchiPlanRow | undefined {
  const sourceEpisode = Number.isFinite(video.episode) && video.episode! > 0 ? Number(video.episode) : fallbackEpisode;
  const docchiId = normalizeDocchiEpisodeId(video.id, anime.id, sourceEpisode);
  if (!docchiId) return undefined;
  return { docchiId, docchiTitle: video.title, docchiAnimeId: anime.id, docchiAnimeName: anime.name, released: video.released, absoluteIndex: fallbackEpisode, season: Number(video.season) || 0, episode: sourceEpisode, sourceEpisode };
}

function choosePlanRow(rows: DocchiPlanRow[], parsed: { season: number; episode: number }, sourceEpisode?: TmdbEpisode): { row: DocchiPlanRow; method: string; confidence: number } | undefined {
  if (!rows.length) return undefined;
  const sourceDate = parseDate(sourceEpisode?.released);
  const sourceTitle = normalizeTitle(sourceEpisode?.title);
  const scored = rows.map((row) => {
    let score = 0;
    const rowDate = parseDate(row.released);
    if (sourceDate && rowDate) {
      const diffDays = Math.abs(Math.round((rowDate.getTime() - sourceDate.getTime()) / 86_400_000));
      if (diffDays === 0) score += 1000;
      else if (diffDays <= 2) score += 850;
      else if (diffDays <= 14) score += 250;
    }
    const titleScore = sourceTitle ? titleSimilarity(sourceTitle, normalizeTitle(row.docchiTitle)) : 0;
    score += Math.round(titleScore * 500);
    if (row.absoluteIndex === parsed.episode) score += 350;
    if (row.season === parsed.season && row.episode === parsed.episode) score += 80;
    return { row, score, titleScore };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return undefined;
  const method = best.score >= 900 ? "date" : best.titleScore >= 0.65 ? "title" : best.row.absoluteIndex === parsed.episode ? "absolute-order" : "low-confidence";
  if (method === "low-confidence" && best.score < 250) return undefined;
  return { row: best.row, method, confidence: best.score };
}

function findTmdbEpisode(videos: TmdbEpisode[] | undefined, season: number, episode: number): TmdbEpisode | undefined {
  const list = videos ?? [];
  return list.find((video) => video.season === season && video.episode === episode)
    ?? list.find((video) => video.episode === episode)
    ?? list[episode - 1];
}

function dedupePlanRows(rows: DocchiPlanRow[]): DocchiPlanRow[] {
  const seen = new Set<string>();
  const result: DocchiPlanRow[] = [];
  for (const row of rows) {
    const key = row.released ? `${row.released}|${normalizeTitle(row.docchiTitle)}` : row.docchiId;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function summarizePlanSeasons(rows: DocchiPlanRow[]): Array<{ season: number; episodes: number; firstDate?: string; lastDate?: string }> {
  const grouped = new Map<number, DocchiPlanRow[]>();
  for (const row of rows) grouped.set(row.season, [...(grouped.get(row.season) ?? []), row]);
  return Array.from(grouped.entries()).map(([season, items]) => {
    const first = items[0];
    const last = items[items.length - 1];
    return { season, episodes: items.length, firstDate: first?.released, lastDate: last?.released };
  });
}

function compareRowsByDateOrIndex(a: DocchiPlanRow, b: DocchiPlanRow): number {
  const aDate = parseDate(a.released)?.getTime();
  const bDate = parseDate(b.released)?.getTime();
  if (aDate && bDate && aDate !== bDate) return aDate - bDate;
  if (aDate && !bDate) return -1;
  if (!aDate && bDate) return 1;
  return a.absoluteIndex - b.absoluteIndex;
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

function sortResolvedAnime(items: DocchiResolvedAnime[]): DocchiResolvedAnime[] {
  return [...items].sort((a, b) => {
    const yearDelta = (a.year ?? 9999) - (b.year ?? 9999);
    if (yearDelta !== 0) return yearDelta;
    const seasonDelta = (a.seasonHint ?? 999) - (b.seasonHint ?? 999);
    if (seasonDelta !== 0) return seasonDelta;
    return 0;
  });
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

function normalizeDocchiEpisodeId(id: string | undefined, animeId: string, episode: number): string | undefined {
  if (id && /^(mal|kitsu):\d+:\d+$/i.test(id)) return id;
  if (episode > 0) return `${animeId}:${episode}`;
  return undefined;
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

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function normalizeTitle(value?: string): string {
  return (value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ąćęłńóśźż]+/gi, " ").replace(/\b(?:czesc|część|part|episode|odcinek)\b/g, " ").replace(/\s+/g, " ").trim();
}

function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aWords = new Set(a.split(" ").filter((word) => word.length > 2));
  const bWords = new Set(b.split(" ").filter((word) => word.length > 2));
  if (!aWords.size || !bWords.size) return 0;
  const common = Array.from(aWords).filter((word) => bWords.has(word)).length;
  return common / Math.max(aWords.size, bWords.size);
}
