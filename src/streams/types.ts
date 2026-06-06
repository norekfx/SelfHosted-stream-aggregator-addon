export type StreamType = "movie" | "series";

export type AggregatedStream = {
  id: string;
  name: string;
  title: string;
  sourceAddon?: string;
  originalUrl?: string;
  quality?: string;
  audioLanguage?: string;
  subtitleLanguage?: string;
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
