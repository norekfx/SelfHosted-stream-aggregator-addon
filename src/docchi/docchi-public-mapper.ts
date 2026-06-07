import { fetchAddonStreams, buildStreamUrl, type AddonStreamFetchResult } from "../addons/addon-stream-client.js";
import { listAddons } from "../addons/addon-registry.js";
import type { RegisteredAddon } from "../addons/types.js";
import { getAppSettings } from "../settings/app-settings.js";
import { writeSystemLog } from "../system/system-log.js";
import type { StreamType } from "../streams/types.js";

export type DocchiEpisodeFix = {
  originalId: string;
  mappedId: string;
  fixed: boolean;
  forced?: boolean;
  triedIds: string[];
  addonName?: string;
  streamCount: number;
};

const cache = new Map<string, DocchiEpisodeFix>();

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
  if (!result.fixed || result.mappedId === id) return [];

  writeSystemLog("info", "docchi", "Docchi fixed episode index for stream aggregation.", {
    originalId: result.originalId,
    mappedId: result.mappedId,
    addonName: result.addonName,
    streamCount: result.streamCount
  });

  return Promise.all(docchiAddons.map((addon) => fetchAddonStreamsWithLog(addon, type, result.mappedId, "fixed-stream-fetch")));
}

export async function findDocchiEpisodeFix(originalId: string, options: { addons?: RegisteredAddon[]; force?: boolean } = {}): Promise<DocchiEpisodeFix> {
  const forced = options.force === true || options.addons === undefined;
  const cached = cache.get(originalId);
  if (cached && !forced) return cached;

  const addons = options.addons ?? getEnabledDocchiAddons();
  const parsed = parseEpisodeId(originalId);
  const fallback: DocchiEpisodeFix = { originalId, mappedId: originalId, fixed: false, forced, triedIds: [], streamCount: 0 };
  if (!parsed || !addons.length || (!forced && !isDocchiMappingGloballyEnabled())) return fallback;

  const candidates = generateCandidateIds(parsed.seriesId, parsed.season, parsed.episode, forced);
  const triedIds: string[] = [];

  writeSystemLog("info", "docchi", forced ? "Docchi force mapping started." : "Docchi mapping probe started.", {
    originalId,
    candidateCount: candidates.length,
    addonCount: addons.length,
    forced
  });

  for (const candidateId of candidates) {
    triedIds.push(candidateId);
    for (const addon of addons) {
      const response = await fetchAddonStreamsWithLog(addon, "series", candidateId, forced ? "force-mapping-probe" : "mapping-probe");
      if (response.status === "fulfilled" && response.streams.length > 0) {
        const fix: DocchiEpisodeFix = {
          originalId,
          mappedId: candidateId,
          fixed: candidateId !== originalId,
          forced,
          triedIds,
          addonName: addon.name,
          streamCount: response.streams.length
        };
        cache.set(originalId, fix);
        writeSystemLog("info", "docchi", forced ? "Docchi force mapping found streams." : "Docchi mapping found streams.", fix);
        return fix;
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
    ids: fixes.map((fix) => ({ originalId: fix.originalId, mappedId: fix.mappedId, fixed: fix.fixed, streamCount: fix.streamCount }))
  });
  return fixes;
}

async function fetchAddonStreamsWithLog(addon: RegisteredAddon, type: StreamType, id: string, phase: string): Promise<AddonStreamFetchResult> {
  const url = buildStreamUrl(addon.manifestUrl, type, id);
  writeSystemLog("info", "docchi", "Docchi request sent.", {
    phase,
    addonId: addon.id,
    addonName: addon.name,
    manifestUrl: addon.manifestUrl,
    requestUrl: url,
    type,
    id
  });
  const result = await fetchAddonStreams(addon, type, id);
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

function generateCandidateIds(seriesId: string, season: number, episode: number, forced = false): string[] {
  const candidates = new Set<string>();
  candidates.add(`${seriesId}:${season}:${episode}`);

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
      if (mapped) candidates.add(`${seriesId}:${mapped.season}:${mapped.episode}`);
    }
  }

  if (forced) {
    const maxSeason = Math.min(12, Math.max(2, Math.ceil(episode / 10)));
    for (let candidateSeason = 1; candidateSeason <= maxSeason; candidateSeason += 1) {
      for (const seasonLength of [10, 11, 12, 13, 24, 25, 26]) {
        const candidateEpisode = episode - ((candidateSeason - 1) * seasonLength);
        if (candidateEpisode > 0 && candidateEpisode <= Math.max(26, seasonLength)) {
          candidates.add(`${seriesId}:${candidateSeason}:${candidateEpisode}`);
        }
      }
    }
  }

  return Array.from(candidates).slice(0, forced ? 60 : 12);
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
