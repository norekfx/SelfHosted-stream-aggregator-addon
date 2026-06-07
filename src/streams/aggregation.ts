import { fetchAddonStreams, type AddonStreamFetchResult, type ExternalStremioStream } from "../addons/addon-stream-client.js";
import { listAddons } from "../addons/addon-registry.js";
import type { RegisteredAddon } from "../addons/types.js";
import { getAppSettings, getEffectiveLinkValidationMode, getEffectiveStreamValidationTimeoutMs, type LinkValidationMode } from "../settings/app-settings.js";
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
  const addonResults = await Promise.all(
    activeAddons.map((addon) => fetchAddonStreams(addon, type, id))
  );

  const rawStreams = addonResults.flatMap((result) =>
    result.streams.map((stream) => ({ addon: result.addon, stream }))
  );

  const streams = rawStreams.map(({ addon, stream }) => mapExternalStream(addon, stream));
  await validateStreamsByMode(streams, rankingPreferences, getEffectiveLinkValidationMode(), getEffectiveStreamValidationTimeoutMs());

  const rankedStreams = rankWorkingStreams(streams, rankingPreferences);
  const selectedOriginal = selectBestOriginalStream(streams, rankingPreferences);

  return {
    type,
    id,
    searchedAt: new Date().toISOString(),
    addonCount: activeAddons.length,
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
      { url: stream.url, externalUrl: stream.externalUrl, infoHash: stream.infoHash },
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
