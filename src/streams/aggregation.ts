import { fetchAddonStreams, type AddonStreamFetchResult, type ExternalStremioStream } from "../addons/addon-stream-client.js";
import { listAddons } from "../addons/addon-registry.js";
import type { RegisteredAddon } from "../addons/types.js";
import { getDocchiEpisodeMappingByMappedId, listDocchiEpisodeMappingsForSeries } from "../docchi/docchi-episode-mapping-store.js";
import { fetchDocchiFixedStreams } from "../docchi/docchi-public-mapper.js";
import { getAppSettings, getEffectiveLinkValidationMode, getEffectiveStreamValidationTimeoutMs, type LinkValidationMode } from "../settings/app-settings.js";
import { writeSystemLog } from "../system/system-log.js";
import { parseStreamMetadata } from "./parse-stream-metadata.js";
import { rankCandidateStreams, rankWorkingStreams, selectBestOriginalStream, type RankedStream } from "./rank-streams.js";
import type { NormalizedStreamMetadata } from "./stream-metadata.js";
import { notChecked, type StreamValidationResult } from "./stream-validation.js";
import type { StreamType } from "./types.js";
import { validateStream } from "./validate-stream-url.js";

export type RawAggregatedStream = {
  addonId: string;
  addonName?: string;
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  externalUrl?: string;
  infoHash?: string;
  fileIdx?: number;
  sources?: string[];
  behaviorHints?: Record<string, unknown>;
  metadata: NormalizedStreamMetadata;
  validation: StreamValidationResult;
};

export type AggregationPreferences = {
  preferredAudioLanguage?: string;
  preferredSubtitleLanguage?: string;
};

export type AggregationResult = {
  type: StreamType;
  id: string;
  searchedAt: string;
  addonCount: number;
  successfulAddonCount: number;
  failedAddonCount: number;
  streamCount: number;
  validatedStreamCount: number;
  workingStreamCount: number;
  failedStreamCount: number;
  unsupportedStreamCount: number;
  addonResults: AddonStreamFetchResult[];
  streams: RawAggregatedStream[];
  rankedStreams: RankedStream[];
  selectedOriginal: RankedStream | null;
};

type EpisodeMappingSummary = { originalId: string; mappedId: string; docchiId?: string; seriesId: string; sourceSeason: number; mappedSeason: number; sourceEpisode: number; mappedEpisode: number };

export async function aggregateStreams(
  type: StreamType,
  id: string,
  preferences: AggregationPreferences = {}
): Promise<AggregationResult> {
  const settings = getAppSettings();
  const rankingPreferences = {
    preferredAudioLanguage: preferences.preferredAudioLanguage ?? settings.preferredAudioLanguage,
    preferredSubtitleLanguage: preferences.preferredSubtitleLanguage ?? settings.preferredSubtitleLanguage
  };

  const activeAddons = listAddons().filter(isStreamAddonEnabled);
  const persistedDocchiMapping = type === "series" ? getDocchiEpisodeMappingByMappedId(id) : undefined;
  const regularAddonId = persistedDocchiMapping?.originalId ?? id;
  const seriesMappings = persistedDocchiMapping ? listDocchiEpisodeMappingsForSeries(persistedDocchiMapping.seriesId) : [];
  const docchiOnlyReason = getDocchiOnlyReason(settings.docchiStreamForceMode, persistedDocchiMapping, seriesMappings);
  const useDocchiOnly = Boolean(docchiOnlyReason);
  if (useDocchiOnly) {
    writeSystemLog("warn", "aggregation", "Docchi stream force mode skipped regular addons for mapped episode.", {
      mode: settings.docchiStreamForceMode,
      reason: docchiOnlyReason,
      requestedId: id,
      originalId: persistedDocchiMapping?.originalId,
      mappedId: persistedDocchiMapping?.mappedId,
      docchiId: persistedDocchiMapping?.docchiId,
      sourceSeasons: countDistinct(seriesMappings.map((mapping) => mapping.sourceSeason)),
      mappedSeasons: countDistinct(seriesMappings.map((mapping) => mapping.mappedSeason)),
      mappedEpisodes: seriesMappings.length,
      skippedRegularAddons: activeAddons.length
    });
  } else if (persistedDocchiMapping && regularAddonId !== id) {
    writeSystemLog("info", "aggregation", "Using original TMDB/IMDb episode id for regular addons and mapped Docchi id for Docchi.", {
      mode: settings.docchiStreamForceMode,
      requestedId: id,
      regularAddonId,
      docchiId: persistedDocchiMapping.docchiId,
      originalId: persistedDocchiMapping.originalId,
      mappedId: persistedDocchiMapping.mappedId
    });
  }

  const [regularAddonResults, docchiFixedResults] = await Promise.all([
    useDocchiOnly ? Promise.resolve([] as AddonStreamFetchResult[]) : Promise.all(activeAddons.map((addon) => fetchAddonStreams(addon, type, regularAddonId))),
    fetchDocchiFixedStreams(type, id)
  ]);
  const addonResults = [...regularAddonResults, ...docchiFixedResults];

  const rawStreams = addonResults.flatMap((result) =>
    result.streams.map((stream) => ({ addon: result.addon, stream }))
  );

  const streams = rawStreams.map(({ addon, stream }) => mapExternalStream(addon, stream));
  const validationMode = settings.detectDebridPlaceholders ? settings.debridPlaceholderValidationMode : getEffectiveLinkValidationMode();
  await validateStreamsByMode(streams, rankingPreferences, validationMode, getEffectiveStreamValidationTimeoutMs());

  const rankedStreams = rankWorkingStreams(streams, rankingPreferences);
  const strictSelectedOriginal = selectBestOriginalStream(streams, rankingPreferences);
  const docchiFallbackOriginal = useDocchiOnly && !strictSelectedOriginal ? selectBestPlayableCandidate(streams, rankingPreferences) : null;
  if (docchiFallbackOriginal) {
    writeSystemLog("warn", "aggregation", "Docchi-only mode returned a stream candidate without strict working validation.", {
      requestedId: id,
      addonId: docchiFallbackOriginal.addonId,
      addonName: docchiFallbackOriginal.addonName,
      title: docchiFallbackOriginal.title ?? docchiFallbackOriginal.name,
      validationStatus: docchiFallbackOriginal.validation.status,
      validationReason: docchiFallbackOriginal.validation.reason
    });
  }
  const selectedOriginal = strictSelectedOriginal ?? docchiFallbackOriginal;

  return {
    type,
    id,
    searchedAt: new Date().toISOString(),
    addonCount: useDocchiOnly ? docchiFixedResults.length : activeAddons.length,
    successfulAddonCount: addonResults.filter((result) => result.status === "fulfilled").length,
    failedAddonCount: addonResults.filter((result) => result.status === "rejected").length,
    streamCount: streams.length,
    validatedStreamCount: streams.filter((stream) => stream.validation.status !== "pending").length,
    workingStreamCount: streams.filter((stream) => stream.validation.status === "working").length,
    failedStreamCount: streams.filter((stream) => stream.validation.status === "failed").length,
    unsupportedStreamCount: streams.filter((stream) => stream.validation.status === "unsupported").length,
    addonResults,
    streams,
    rankedStreams,
    selectedOriginal
  };
}

function getDocchiOnlyReason(mode: string, mapping: EpisodeMappingSummary | undefined, seriesMappings: EpisodeMappingSummary[]): string | undefined {
  if (!mapping?.docchiId) return undefined;
  if (mode === "enabled") return "enabled";
  if (mode !== "partial") return undefined;
  if (mapping.originalId !== mapping.mappedId) return "partial:mapped-id-differs";
  if (mapping.sourceSeason !== mapping.mappedSeason || mapping.sourceEpisode !== mapping.mappedEpisode) return "partial:episode-index-differs";
  const sourceSeasons = countDistinct(seriesMappings.map((item) => item.sourceSeason));
  const mappedSeasons = countDistinct(seriesMappings.map((item) => item.mappedSeason));
  if (sourceSeasons > 0 && mappedSeasons > 0 && sourceSeasons !== mappedSeasons) return "partial:season-structure-differs";
  return undefined;
}

function countDistinct(values: Array<number | undefined>): number {
  return new Set(values.filter((value): value is number => Number.isFinite(value))).size;
}

function selectBestPlayableCandidate(streams: RawAggregatedStream[], preferences: { preferredAudioLanguage: string; preferredSubtitleLanguage: string }): RankedStream | null {
  return rankCandidateStreams(streams.filter((stream) => Boolean(stream.url || stream.externalUrl)), preferences)[0] ?? null;
}

function isStreamAddonEnabled(addon: RegisteredAddon): boolean {
  return addon.enabled && addon.status === "online" && addon.supportedResources.includes("stream");
}

function mapExternalStream(addon: RegisteredAddon, stream: ExternalStremioStream): RawAggregatedStream {
  const filename = typeof stream.behaviorHints?.filename === "string" ? stream.behaviorHints.filename : undefined;

  return {
    addonId: addon.id,
    addonName: addon.name,
    name: stream.name,
    title: stream.title,
    description: stream.description,
    url: stream.url,
    externalUrl: stream.externalUrl,
    infoHash: stream.infoHash,
    fileIdx: stream.fileIdx,
    sources: stream.sources,
    behaviorHints: stream.behaviorHints,
    metadata: parseStreamMetadata({ name: stream.name, title: stream.title, filename, description: stream.description }),
    validation: notChecked()
  };
}

async function validateStreamsByMode(streams: RawAggregatedStream[], preferences: { preferredAudioLanguage: string; preferredSubtitleLanguage: string }, mode: LinkValidationMode, timeoutMs: number): Promise<void> {
  const ordered = rankCandidateStreams(streams, preferences);
  const targetWorkingCount = getTargetWorkingCount(mode);
  let workingCount = 0;

  for (let index = 0; index < ordered.length; index += 1) {
    const stream = ordered[index];
    if (!stream) continue;

    if (targetWorkingCount !== undefined && workingCount >= targetWorkingCount) {
      stream.validation = notChecked(`Skipped because ${targetWorkingCount} working links were already found.`);
      continue;
    }

    stream.validation = await validateStream(
      {
        url: stream.url,
        externalUrl: stream.externalUrl,
        infoHash: stream.infoHash,
        rawText: stream.metadata.rawText,
        declaredSize: stream.metadata.size,
        isDebrid: hasDebridHint(`${stream.name ?? ""} ${stream.title ?? ""} ${stream.description ?? ""} ${String(stream.behaviorHints?.filename ?? "")}`)
      },
      timeoutMs
    );

    if (stream.validation.status === "working") {
      workingCount += 1;
    }

    if (mode === "best" && stream.validation.status === "working") {
      for (const skipped of ordered.slice(index + 1)) {
        skipped.validation = notChecked("Skipped because best working link was already found.");
      }
      break;
    }
  }
}

function getTargetWorkingCount(mode: LinkValidationMode): number | undefined {
  if (mode === "all" || mode === "best") return undefined;
  const parsed = Number.parseInt(mode, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function hasDebridHint(value: string): boolean {
  return /\[(?:RD\s*(?:⚡|\+)?|PM\+?|AD\+?)\]|\b(?:real[-\s]?debrid|alldebrid|all[-\s]?debrid|premiumize|debrid)\b/i.test(value);
}
