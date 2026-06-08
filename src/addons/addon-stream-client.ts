import { z } from "zod";
import type { RegisteredAddon } from "./types.js";
import type { StreamType } from "../streams/types.js";

const stremioStreamSchema = z.object({
  name: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  url: z.string().url().optional(),
  externalUrl: z.string().url().optional(),
  infoHash: z.string().optional(),
  fileIdx: z.number().int().optional(),
  sources: z.array(z.string()).optional(),
  behaviorHints: z.record(z.unknown()).optional()
}).passthrough();

const streamResponseSchema = z.object({
  streams: z.array(stremioStreamSchema).default([])
}).passthrough();

export type ExternalStremioStream = z.infer<typeof stremioStreamSchema>;

export type AddonStreamFetchResult = {
  addon: RegisteredAddon;
  status: "fulfilled" | "rejected";
  responseTimeMs: number;
  streams: ExternalStremioStream[];
  error?: string;
};

export async function fetchAddonStreams(
  addon: RegisteredAddon,
  type: StreamType,
  id: string,
  timeoutMs = 12000
): Promise<AddonStreamFetchResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const streamUrl = buildStreamUrl(addon.manifestUrl, type, id);
    const response = await fetch(streamUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Stream request failed with HTTP ${response.status}.`);
    }

    const json = await response.json();
    const parsed = streamResponseSchema.parse(json);

    return {
      addon,
      status: "fulfilled",
      responseTimeMs: Date.now() - startedAt,
      streams: parsed.streams
    };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? `Stream request timed out after ${timeoutMs}ms.`
      : error instanceof Error
        ? error.message
        : "Unknown stream request error.";

    return {
      addon,
      status: "rejected",
      responseTimeMs: Date.now() - startedAt,
      streams: [],
      error: message
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function buildStreamUrl(manifestUrl: string, type: StreamType, id: string): string {
  const url = new URL(manifestUrl);
  const encodedType = encodeURIComponent(type);
  const encodedId = encodeURIComponent(id).replace(/%3A/gi, ":");
  url.pathname = url.pathname.replace(/\/manifest\.json$/, `/stream/${encodedType}/${encodedId}.json`);
  return url.toString();
}
