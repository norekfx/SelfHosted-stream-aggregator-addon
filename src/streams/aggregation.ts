import { fetchAddonStreams, type AddonStreamFetchResult, type ExternalStremioStream } from "../addons/addon-stream-client.js";
import { listAddons } from "../addons/addon-registry.js";
import type { RegisteredAddon } from "../addons/types.js";
import { getAppSettings, getEffectiveStreamValidationTimeoutMs } from "../settings/app-settings.js";
import { parseStreamMetadata } from "./parse-stream-metadata.js";
import { rankWorkingStreams, selectBestOriginalStream, type RankedStream } from "./rank-streams.js";
import type { NormalizedStreamMetadata } from "./stream-metadata.js";
import type { StreamValidationResult } from "./stream-validation.js";
import type { StreamType } from "./types.js";
import { validateStream } from "./validate-stream-url.js";

export type RawAggregatedStream = {
  addonId: string;
  addonName?: string;
  name?: string;
  title?: string;
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

  const streams = await Promise.all(
    rawStreams.map(({ addon, stream }) => mapExternalStream(addon, stream))
  );

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

async function mapExternalStream(addon: RegisteredAddon, stream: ExternalStremioStream): Promise<RawAggregatedStream> {
  const filename = typeof stream.behaviorHints?.filename === "string" ? stream.behaviorHints.filename : undefined;

  return {
    addonId: addon.id,
    addonName: addon.name,
    name: stream.name,
    title: stream.title,
    url: stream.url,
    externalUrl: stream.externalUrl,
    infoHash: stream.infoHash,
    fileIdx: stream.fileIdx,
    sources: stream.sources,
    behaviorHints: stream.behaviorHints,
    metadata: parseStreamMetadata({ name: stream.name, title: stream.title, filename }),
    validation: await validateStream(
      { url: stream.url, externalUrl: stream.externalUrl, infoHash: stream.infoHash },
      getEffectiveStreamValidationTimeoutMs()
    )
  };
}
