import type { NormalizedStreamMetadata } from "./stream-metadata.js";

export type StreamType = "movie" | "series";

export type AggregatedStream = {
  id: string;
  name: string;
  title: string;
  description?: string;
  sourceAddon?: string;
  originalUrl?: string;
  quality?: string;
  audioLanguage?: string;
  subtitleLanguage?: string;
  fileName?: string;
  metadata?: NormalizedStreamMetadata;
  isValidated: boolean;
  validationStatus: "pending" | "working" | "failed";
  validationReason?: string;
};

export type StremioStream = {
  name: string;
  title: string;
  url?: string;
  externalUrl?: string;
  behaviorHints?: Record<string, unknown>;
};
