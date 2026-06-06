export type AddonResource = "catalog" | "meta" | "stream" | "subtitles";

export type ExternalAddonManifest = {
  id: string;
  version?: string;
  name: string;
  description?: string;
  resources?: Array<string | { name?: string; types?: string[] }>;
  types?: string[];
  idPrefixes?: string[];
  catalogs?: unknown[];
  behaviorHints?: Record<string, unknown>;
};

export type AddonHealthStatus = "unknown" | "online" | "offline" | "invalid";

export type RegisteredAddon = {
  id: string;
  manifestUrl: string;
  name?: string;
  version?: string;
  description?: string;
  supportedResources: AddonResource[];
  supportedTypes: string[];
  status: AddonHealthStatus;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt?: string;
  lastError?: string;
  responseTimeMs?: number;
};

export type AddonRegistrationInput = {
  manifestUrl: string;
  enabled?: boolean;
};

export type AddonHealthResult = {
  status: AddonHealthStatus;
  responseTimeMs?: number;
  manifest?: ExternalAddonManifest;
  error?: string;
};
