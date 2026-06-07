import { fetchAddonStreams, buildStreamUrl, type AddonStreamFetchResult, type ExternalStremioStream } from "../addons/addon-stream-client.js";
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
};

type DocchiMetaPreview = {
  id?: string;
  name?: string;
  type?: string;
  releaseInfo?: string;
};

const cache = new Map<string, DocchiEpisodeFix>();
const searchCache = new Map<string, DocchiMetaPreview[]>();

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
    docchiId: result.docchiId,
    addonName: result.addonName,
    streamCount: result.streamCount
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
  const searchTerms = buildSearchTerms(tmdbMeta?.name ?? parsed.seriesId);
  const episodeCandidates = generateEpisodeCandidates(parsed.season, parsed.episode, forced);
  const triedIds: string[] = [];

  writeSystemLog("info", "docchi", forced ? "Docchi force mapping started." : "Docchi mapping probe started.", {
    originalId,
    searchTerms,
    episodeCandidates,
    addonCount: addons.length,
    forced
  });

  for (const addon of addons) {
    const metas = await searchDocchiAnime(addon, searchTerms, forced ? 10 : 5);
    for (const meta of metas) {
      const baseDocchiId = normalizeDocchiMetaId(meta.id);
      if (!baseDocchiId) continue;
      for (const episode of episodeCandidates) {
        const docchiStreamId = `${baseDocchiId}:${episode}`;
        triedIds.push(docchiStreamId);
        const response = await fetchAddonStreamsWithLog(addon, "anime", docchiStreamId, forced ? "force-public-mal-probe" : "public-mal-probe");
        if (response.status === "fulfilled" && response.streams.length > 0) {
          const mappedId = `${parsed.seriesId}:${parsed.season}:${episode}`;
          const fix: DocchiEpisodeFix = {
            originalId,
            mappedId,
            fixed: docchiStreamId !== originalId,
            forced,
            triedIds,
            addonName: addon.name,
            streamCount: response.streams.length,
            docchiId: docchiStreamId,
            docchiTitle: meta.name
          };
          cache.set(originalId, fix);
          writeSystemLog("info", "docchi", forced ? "Docchi force mapping found streams." : "Docchi mapping found streams.", fix);
          return fix;
        }
      }
    }
  }

  const miss = { ...fallback, triedIds };
  cache.set(originalId, miss);
  writeSystemLog("warn", "docchi", forced ? "Docchi force mapping did not find streams." : "Docchi mapping did not find streams.", miss);
  return miss;
}

export async function forceDocchiEpisodeFixes(ids: string[]): Promise<DocchiEpisodeFix[]> {
  const addons = getEnabledDocchiAddons();
  const uniqueIds = Array.from(new Set(ids.filter((id) => /^tt\d+:\d+:\d+$/i.test(id)))).slice(0, 120);
  writeSystemLog("info", "docchi", "Docchi force scan requested from WebUI.", {
    requestedIds: ids.length,
    uniqueIds: uniqueIds.length,
    addonCount: addons.length
  });

  const fixes: DocchiEpisodeFix[] = [];
  for (const id of uniqueIds) {
    fixes.push(await findDocchiEpisodeFix(id, { addons, force: true }));
  }

  writeSystemLog("info", "docchi", "Docchi force scan finished.", {
    checked: fixes.length,
    fixed: fixes.filter((fix) => fix.fixed).length,
    ids: fixes.map((fix) => ({ originalId: fix.originalId, mappedId: fix.mappedId, docchiId: fix.docchiId, fixed: fix.fixed, streamCount: fix.streamCount }))
  });
  return fixes;
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
  writeSystemLog("info", "docchi", "Docchi catalog search request sent.", {
    addonId: addon.id,
    addonName: addon.name,
    manifestUrl: addon.manifestUrl,
    requestUrl: url,
    search: term
  });

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
      metas: metas.slice(0, 10).map((meta) => ({ id: meta.id, name: meta.name, type: meta.type }))
    });
    return metas;
  } catch (error) {
    writeSystemLog("warn", "docchi", "Docchi catalog search failed.", {
      addonId: addon.id,
      addonName: addon.name,
      search: term,
      responseTimeMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown error"
    });
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAddonStreamsWithLog(addon: RegisteredAddon, type: StreamType | "anime", id: string, phase: string): Promise<AddonStreamFetchResult> {
  const url = buildStreamUrl(addon.manifestUrl, type as StreamType, id);
  writeSystemLog("info", "docchi", "Docchi request sent.", {
    phase,
    addonId: addon.id,
    addonName: addon.name,
    manifestUrl: addon.manifestUrl,
    requestUrl: url,
    type,
    id
  });
  const result = await fetchAddonStreams(addon, type as StreamType, id);
  writeSystemLog(result.status === "fulfilled" ? "info" : "warn", "docchi", "Docchi response received.", {
    phase,
    addonId: addon.id,
    addonName: addon.name,
    type,
    id,
    status: result.status,
    responseTimeMs: result.responseTimeMs,
    streamCount: result.streams.length,
    error: result.error
  });
  return result;
}

function buildCatalogSearchUrl(manifestUrl: string, search: string): string {
  const url = new URL(manifestUrl);
  url.pathname = url.pathname.replace(/\/manifest\.json$/, `/catalog/anime/search_list/search=${encodeURIComponent(search)}.json`);
  return url.toString();
}

function buildSearchTerms(title: string): string[] {
  const clean = title
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:season|sezon|part|cour)\s*\d+\b/gi, " ")
    .replace(/[:–—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const terms = [title, clean];
  const firstColon = title.split(/[:–—-]/)[0]?.trim();
  if (firstColon) terms.push(firstColon);
  return Array.from(new Set(terms.filter((term) => term.length >= 3))).slice(0, 4);
}

function normalizeDocchiMetaId(id?: string): string | undefined {
  if (!id) return undefined;
  const match = id.match(/^(mal|kitsu):(\d+)$/i);
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

function generateEpisodeCandidates(season: number, episode: number, forced = false): number[] {
  const candidates = new Set<number>();
  candidates.add(episode);

  if (season === 1 && episode > 1) {
    const patterns = [
      [12, 12, 12, 12, 12, 12, 12, 12, 12, 12],
      [13, 13, 13, 13, 13, 13, 13, 13, 13, 13],
      [24, 24, 24, 24, 24, 24, 24],
      [25, 25, 25, 25, 25, 25, 25],
      [24, 23, 7, 13, 13, 13, 13],
      [24, 24, 13, 13, 13, 13],
      [25, 13, 13, 13, 13, 13]
    ];
    for (const pattern of patterns) {
      const mapped = remapAbsoluteEpisode(episode, pattern);
      if (mapped) candidates.add(mapped.episode);
    }
  }

  if (forced) {
    for (let value = Math.max(1, episode - 30); value <= episode + 5; value += 1) candidates.add(value);
    for (const seasonLength of [10, 11, 12, 13, 24, 25, 26]) {
      const candidate = episode % seasonLength || seasonLength;
      candidates.add(candidate);
    }
  }

  return Array.from(candidates).filter((value) => value > 0).slice(0, forced ? 60 : 12);
}

function remapAbsoluteEpisode(absoluteEpisode: number, seasonLengths: number[]): { season: number; episode: number } | undefined {
  let remaining = absoluteEpisode;
  for (let index = 0; index < seasonLengths.length; index += 1) {
    const length = seasonLengths[index] ?? 0;
    if (remaining <= length) return { season: index + 1, episode: remaining };
    remaining -= length;
  }
  return undefined;
}
