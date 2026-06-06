import { fetchAddonStreams, type AddonStreamFetchResult, type ExternalStremioStream } from "../addons/addon-stream-client.js";
import { listAddons } from "../addons/addon-registry.js";
import type { RegisteredAddon } from "../addons/types.js";
import type { StreamType } from "./types.js";

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
};

export type AggregationResult = {
  type: StreamType;
  id: string;
  searchedAt: string;
  addonCount: number;
  successfulAddonCount: number;
  failedAddonCount: number;
  streamCount: number;
  addonResults: AddonStreamFetchResult[];
  streams: RawAggregatedStream[];
};

export async function aggregateStreams(type: StreamType, id: string): Promise<AggregationResult> {
  const activeAddons = listAddons().filter(isStreamAddonEnabled);
  const addonResults = await Promise.all(
    activeAddons.map((addon) => fetchAddonStreams(addon, type, id))
  );

  const streams = addonResults.flatMap((result) =>
    result.streams.map((stream) => mapExternalStream(result.addon, stream))
  );

  return {
    type,
    id,
    searchedAt: new Date().toISOString(),
    addonCount: activeAddons.length,
    successfulAddonCount: addonResults.filter((result) => result.status === "fulfilled").length,
    failedAddonCount: addonResults.filter((result) => result.status === "rejected").length,
    streamCount: streams.length,
    addonResults,
    streams
  };
}

function isStreamAddonEnabled(addon: RegisteredAddon): boolean {
  return addon.enabled && addon.status === "online" && addon.supportedResources.includes("stream");
}

function mapExternalStream(addon: RegisteredAddon, stream: ExternalStremioStream): RawAggregatedStream {
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
    behaviorHints: stream.behaviorHints
  };
}
