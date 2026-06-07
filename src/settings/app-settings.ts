import { getDatabase } from "../db/database.js";
import { DEFAULT_PREFERRED_LANGUAGE, EUROPEAN_LANGUAGES } from "../languages/european-languages.js";
import { env } from "../config/env.js";

export type LinkValidationMode = "best" | "all" | "5" | "10" | "20" | "40" | "80" | "100" | "150" | "200";

export type AppSettings = {
  preferredAudioLanguage: string;
  preferredSubtitleLanguage: string;
  preferDebrid: boolean;
  detectDebridPlaceholders: boolean;
  debridPlaceholderValidationMode: LinkValidationMode;
  debridPlaceholderMinSizeMb: number;
  debridPlaceholderMinDurationMinutes: number;
  debridPlaceholderCompareDeclaredSize: boolean;
  debridPlaceholderSizeDifferenceGb: number;
  defaultTranscodeBufferPreset: string;
  streamValidationTimeoutMs: number;
  linkValidationMode: LinkValidationMode;
  maxTranscodeSessions: number;
  publicBaseUrl?: string;
  autoRefreshCache: boolean;
  showDiagnosticDetails: boolean;
  tmdbApiKey?: string;
  tmdbReadAccessToken?: string;
  tmdbLanguage: string;
  tmdbRegion: string;
  autoTranscodeMinQuality: string;
  autoTranscodeMaxQuality: string;
  transcodePreset: string;
  transcodeCrfMode: string;
  transcodeCrfMin: number;
  transcodeCrfMax: number;
  transcodeBitrateMode: string;
  transcodeBitrateMinKbps: number;
  transcodeBitrateMaxKbps: number;
};

const validLanguageCodes = new Set(EUROPEAN_LANGUAGES.map((language) => language.code));
export const TRANSCODE_QUALITY_ORDER = ["144p", "240p", "360p", "480p", "720p", "1080p", "1440p", "4k"] as const;
export const TRANSCODE_PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"] as const;
export const LINK_VALIDATION_MODES = ["best", "all", "5", "10", "20", "40", "80", "100", "150", "200"] as const;

const defaults: AppSettings = {
  preferredAudioLanguage: DEFAULT_PREFERRED_LANGUAGE,
  preferredSubtitleLanguage: DEFAULT_PREFERRED_LANGUAGE,
  preferDebrid: true,
  detectDebridPlaceholders: false,
  debridPlaceholderValidationMode: "best",
  debridPlaceholderMinSizeMb: 30,
  debridPlaceholderMinDurationMinutes: 5,
  debridPlaceholderCompareDeclaredSize: false,
  debridPlaceholderSizeDifferenceGb: 5,
  defaultTranscodeBufferPreset: env.DEFAULT_TRANSCODE_BUFFER_PRESET,
  streamValidationTimeoutMs: env.STREAM_VALIDATION_TIMEOUT_MS,
  linkValidationMode: "best",
  maxTranscodeSessions: env.MAX_TRANSCODE_SESSIONS,
  publicBaseUrl: env.PUBLIC_BASE_URL,
  autoRefreshCache: true,
  showDiagnosticDetails: true,
  tmdbApiKey: undefined,
  tmdbReadAccessToken: undefined,
  tmdbLanguage: "pl-PL",
  tmdbRegion: "PL",
  autoTranscodeMinQuality: "144p",
  autoTranscodeMaxQuality: "1080p",
  transcodePreset: "veryfast",
  transcodeCrfMode: "auto",
  transcodeCrfMin: 22,
  transcodeCrfMax: 26,
  transcodeBitrateMode: "auto",
  transcodeBitrateMinKbps: 1000,
  transcodeBitrateMaxKbps: 6000
};

export function getAppSettings(): AppSettings {
  const rows = getDatabase()
    .prepare("SELECT key, value FROM app_settings")
    .all() as Array<{ key: keyof AppSettings; value: string }>;

  const settings = { ...defaults };
  for (const row of rows) {
    if (["streamValidationTimeoutMs", "maxTranscodeSessions", "transcodeCrfMin", "transcodeCrfMax", "transcodeBitrateMinKbps", "transcodeBitrateMaxKbps", "debridPlaceholderMinSizeMb", "debridPlaceholderMinDurationMinutes", "debridPlaceholderSizeDifferenceGb"].includes(row.key)) {
      const parsed = Number.parseInt(row.value, 10);
      if (Number.isFinite(parsed)) {
        (settings as Record<string, unknown>)[row.key] = parsed;
      }
      continue;
    }

    if (row.key === "preferDebrid" || row.key === "detectDebridPlaceholders" || row.key === "debridPlaceholderCompareDeclaredSize" || row.key === "autoRefreshCache" || row.key === "showDiagnosticDetails") {
      settings[row.key] = row.value === "true";
      continue;
    }

    if ((row.key === "publicBaseUrl" || row.key === "tmdbApiKey" || row.key === "tmdbReadAccessToken") && row.value.trim() === "") {
      (settings as Record<string, unknown>)[row.key] = undefined;
      continue;
    }

    if (row.key === "preferredAudioLanguage" || row.key === "preferredSubtitleLanguage") {
      const value = normalizeLanguageCode(row.value);
      settings[row.key] = value;
      continue;
    }

    (settings as Record<string, unknown>)[row.key] = row.value;
  }

  return normalizeTranscodeSettings(settings);
}

export function updateAppSettings(input: Partial<AppSettings>): AppSettings {
  const allowedKeys = Object.keys(defaults) as Array<keyof AppSettings>;
  const now = new Date().toISOString();
  const statement = getDatabase().prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  const sanitized = normalizeTranscodeSettings({ ...getAppSettings(), ...input });
  const transaction = getDatabase().transaction(() => {
    for (const key of allowedKeys) {
      let value = sanitized[key];
      if (value === undefined) {
        continue;
      }

      if (key === "preferredAudioLanguage" || key === "preferredSubtitleLanguage") {
        value = normalizeLanguageCode(String(value)) as never;
      }

      statement.run(key, String(value), now);
    }
  });

  transaction();
  return getAppSettings();
}

export function getEffectivePublicBaseUrl(): string | undefined {
  return getAppSettings().publicBaseUrl ?? env.PUBLIC_BASE_URL;
}

export function getEffectiveStreamValidationTimeoutMs(): number {
  return getAppSettings().streamValidationTimeoutMs;
}

export function getEffectiveLinkValidationMode(): LinkValidationMode {
  return getAppSettings().linkValidationMode;
}

export function getEffectiveMaxTranscodeSessions(): number {
  return getAppSettings().maxTranscodeSessions;
}

export function getEffectiveTranscodeBufferPreset(): string {
  return getAppSettings().defaultTranscodeBufferPreset;
}

export function getEffectiveTranscodeSettings(): AppSettings {
  return getAppSettings();
}

function normalizeLanguageCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return DEFAULT_PREFERRED_LANGUAGE;
  if (normalized === "sq") return DEFAULT_PREFERRED_LANGUAGE;
  return validLanguageCodes.has(normalized) ? normalized : DEFAULT_PREFERRED_LANGUAGE;
}

function normalizeTranscodeSettings(settings: AppSettings): AppSettings {
  const normalized = { ...settings };
  normalized.preferDebrid = normalized.preferDebrid !== false;
  normalized.detectDebridPlaceholders = normalized.detectDebridPlaceholders === true;
  normalized.debridPlaceholderCompareDeclaredSize = normalized.debridPlaceholderCompareDeclaredSize === true;
  normalized.tmdbApiKey = normalized.tmdbApiKey?.trim() || undefined;
  normalized.tmdbReadAccessToken = normalized.tmdbReadAccessToken?.trim() || undefined;
  normalized.tmdbLanguage = normalized.tmdbLanguage?.trim() || defaults.tmdbLanguage;
  normalized.tmdbRegion = normalized.tmdbRegion?.trim().toUpperCase() || defaults.tmdbRegion;
  normalized.debridPlaceholderMinSizeMb = clampNumber(normalized.debridPlaceholderMinSizeMb, 1, 102400, defaults.debridPlaceholderMinSizeMb);
  normalized.debridPlaceholderMinDurationMinutes = clampNumber(normalized.debridPlaceholderMinDurationMinutes, 1, 1440, defaults.debridPlaceholderMinDurationMinutes);
  normalized.debridPlaceholderSizeDifferenceGb = clampNumber(normalized.debridPlaceholderSizeDifferenceGb, 1, 1024, defaults.debridPlaceholderSizeDifferenceGb);

  if (!TRANSCODE_QUALITY_ORDER.includes(normalized.autoTranscodeMinQuality as never)) normalized.autoTranscodeMinQuality = defaults.autoTranscodeMinQuality;
  if (!TRANSCODE_QUALITY_ORDER.includes(normalized.autoTranscodeMaxQuality as never)) normalized.autoTranscodeMaxQuality = defaults.autoTranscodeMaxQuality;
  if (!LINK_VALIDATION_MODES.includes(normalized.linkValidationMode as never)) normalized.linkValidationMode = defaults.linkValidationMode;
  if (!LINK_VALIDATION_MODES.includes(normalized.debridPlaceholderValidationMode as never)) normalized.debridPlaceholderValidationMode = defaults.debridPlaceholderValidationMode;

  const minIndex = TRANSCODE_QUALITY_ORDER.indexOf(normalized.autoTranscodeMinQuality as never);
  const maxIndex = TRANSCODE_QUALITY_ORDER.indexOf(normalized.autoTranscodeMaxQuality as never);
  if (minIndex > maxIndex) {
    normalized.autoTranscodeMinQuality = normalized.autoTranscodeMaxQuality;
  }

  if (!TRANSCODE_PRESETS.includes(normalized.transcodePreset as never)) normalized.transcodePreset = defaults.transcodePreset;
  if (!["auto", "range"].includes(normalized.transcodeCrfMode)) normalized.transcodeCrfMode = "auto";
  if (!["auto", "range"].includes(normalized.transcodeBitrateMode)) normalized.transcodeBitrateMode = "auto";

  normalized.transcodeCrfMin = clampNumber(normalized.transcodeCrfMin, 16, 35, defaults.transcodeCrfMin);
  normalized.transcodeCrfMax = clampNumber(normalized.transcodeCrfMax, 16, 35, defaults.transcodeCrfMax);
  if (normalized.transcodeCrfMin > normalized.transcodeCrfMax) normalized.transcodeCrfMin = normalized.transcodeCrfMax;

  normalized.transcodeBitrateMinKbps = clampNumber(normalized.transcodeBitrateMinKbps, 150, 50000, defaults.transcodeBitrateMinKbps);
  normalized.transcodeBitrateMaxKbps = clampNumber(normalized.transcodeBitrateMaxKbps, 150, 50000, defaults.transcodeBitrateMaxKbps);
  if (normalized.transcodeBitrateMinKbps > normalized.transcodeBitrateMaxKbps) normalized.transcodeBitrateMinKbps = normalized.transcodeBitrateMaxKbps;

  return normalized;
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
