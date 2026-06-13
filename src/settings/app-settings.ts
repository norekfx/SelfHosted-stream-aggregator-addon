import { getDatabase } from "../db/database.js";
import { DEFAULT_PREFERRED_LANGUAGE, EUROPEAN_LANGUAGES } from "../languages/european-languages.js";
import { env } from "../config/env.js";

export type LinkValidationMode = "best" | "all" | "5" | "10" | "20" | "40" | "80" | "100" | "150" | "200";
export type MetadataSyncIntervalMinutes = 0 | 10 | 30 | 60 | 120 | 240 | 480 | 720 | 1440;
export type DocchiPublicMappingMode = "disabled" | "animation_series" | "series" | "all";
export type DocchiKometaAnimeIdsRefreshInterval = "daily" | "weekly" | "biweekly" | "monthly" | "once";
export type DocchiStreamForceMode = "enabled" | "disabled" | "partial";
export type TranscodeMode = "vod" | "live";
export type VodBufferProgression = "target" | "infinite";
export type VodQualityMode = "disabled" | "enabled" | "auto";
export type VodBitrateMode = "auto" | "250" | "500" | "800" | "1200" | "1800" | "2500" | "3500" | "5000" | "8000" | "12000" | "18000";
export type VodAudioMode = "aac" | "copy" | "disabled";
export type IntelQsvMode = "disabled" | "encode" | "decode_encode";

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
  metadataSyncIntervalMinutes: number;
  docchiPublicMappingMode: DocchiPublicMappingMode;
  docchiKometaAnimeIdsEnabled: boolean;
  docchiKometaAnimeIdsRefreshInterval: DocchiKometaAnimeIdsRefreshInterval;
  docchiStreamForceMode: DocchiStreamForceMode;
  autoTranscodeMinQuality: string;
  autoTranscodeMaxQuality: string;
  transcodePreset: string;
  transcodeCrfMode: string;
  transcodeCrfMin: number;
  transcodeCrfMax: number;
  transcodeBitrateMode: string;
  transcodeBitrateMinKbps: number;
  transcodeBitrateMaxKbps: number;
  transcodeMode: TranscodeMode;
  liveIntelQsvMode: IntelQsvMode;
  vodIntelQsvMode: IntelQsvMode;
  vodSegmentSeconds: number;
  vodStartupBufferSeconds: number;
  vodBufferProgression: VodBufferProgression;
  vodAdaptiveBatchEnabled: boolean;
  vodFixedBatchSegmentCount: number;
  vodQualityMode: VodQualityMode;
  vodCrf: number;
  vodBitrateMode: VodBitrateMode;
  vodAudioMode: VodAudioMode;
};

const validLanguageCodes = new Set(EUROPEAN_LANGUAGES.map((language) => language.code));
export const TRANSCODE_QUALITY_ORDER = ["144p", "240p", "360p", "480p", "720p", "1080p", "1440p", "4k"] as const;
export const TRANSCODE_PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"] as const;
export const TRANSCODE_MODES = ["vod", "live"] as const;
export const INTEL_QSV_MODES = ["disabled", "encode", "decode_encode"] as const;
export const VOD_BUFFER_PROGRESSION_MODES = ["target", "infinite"] as const;
export const VOD_QUALITY_MODES = ["disabled", "enabled", "auto"] as const;
export const VOD_BITRATE_MODES = ["auto", "250", "500", "800", "1200", "1800", "2500", "3500", "5000", "8000", "12000", "18000"] as const;
export const VOD_AUDIO_MODES = ["aac", "copy", "disabled"] as const;
export const LINK_VALIDATION_MODES = ["best", "all", "5", "10", "20", "40", "80", "100", "150", "200"] as const;
export const METADATA_SYNC_INTERVALS = [0, 10, 30, 60, 120, 240, 480, 720, 1440] as const;
export const DOCCHI_PUBLIC_MAPPING_MODES = ["disabled", "animation_series", "series", "all"] as const;
export const DOCCHI_KOMETA_ANIME_IDS_REFRESH_INTERVALS = ["daily", "weekly", "biweekly", "monthly", "once"] as const;
export const DOCCHI_STREAM_FORCE_MODES = ["enabled", "disabled", "partial"] as const;

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
  metadataSyncIntervalMinutes: 1440,
  docchiPublicMappingMode: "disabled",
  docchiKometaAnimeIdsEnabled: false,
  docchiKometaAnimeIdsRefreshInterval: "daily",
  docchiStreamForceMode: "partial",
  autoTranscodeMinQuality: "144p",
  autoTranscodeMaxQuality: "1080p",
  transcodePreset: "veryfast",
  transcodeCrfMode: "auto",
  transcodeCrfMin: 22,
  transcodeCrfMax: 26,
  transcodeBitrateMode: "auto",
  transcodeBitrateMinKbps: 1000,
  transcodeBitrateMaxKbps: 6000,
  transcodeMode: "vod",
  liveIntelQsvMode: "disabled",
  vodIntelQsvMode: "disabled",
  vodSegmentSeconds: 10,
  vodStartupBufferSeconds: 60,
  vodBufferProgression: "infinite",
  vodAdaptiveBatchEnabled: false,
  vodFixedBatchSegmentCount: 12,
  vodQualityMode: "auto",
  vodCrf: 26,
  vodBitrateMode: "auto",
  vodAudioMode: "aac"
};

export function getAppSettings(): AppSettings {
  const rows = getDatabase()
    .prepare("SELECT key, value FROM app_settings")
    .all() as Array<{ key: keyof AppSettings; value: string }>;

  const settings = { ...defaults };
  for (const row of rows) {
    if (["streamValidationTimeoutMs", "maxTranscodeSessions", "transcodeCrfMin", "transcodeCrfMax", "transcodeBitrateMinKbps", "transcodeBitrateMaxKbps", "debridPlaceholderMinSizeMb", "debridPlaceholderMinDurationMinutes", "debridPlaceholderSizeDifferenceGb", "metadataSyncIntervalMinutes", "vodSegmentSeconds", "vodStartupBufferSeconds", "vodFixedBatchSegmentCount", "vodCrf"].includes(row.key)) {
      const parsed = Number.parseInt(row.value, 10);
      if (Number.isFinite(parsed)) {
        (settings as Record<string, unknown>)[row.key] = parsed;
      }
      continue;
    }

    if (row.key === "preferDebrid" || row.key === "detectDebridPlaceholders" || row.key === "debridPlaceholderCompareDeclaredSize" || row.key === "autoRefreshCache" || row.key === "showDiagnosticDetails" || row.key === "docchiKometaAnimeIdsEnabled" || row.key === "vodAdaptiveBatchEnabled") {
      (settings as Record<string, unknown>)[row.key] = row.value === "true";
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

export function getEffectiveTranscodeMode(): TranscodeMode {
  return getAppSettings().transcodeMode;
}

function normalizeTranscodeSettings(settings: AppSettings): AppSettings {
  const normalized = { ...settings };
  if (!TRANSCODE_MODES.includes(normalized.transcodeMode)) normalized.transcodeMode = defaults.transcodeMode;
  if (!INTEL_QSV_MODES.includes(normalized.liveIntelQsvMode)) normalized.liveIntelQsvMode = defaults.liveIntelQsvMode;
  if (!INTEL_QSV_MODES.includes(normalized.vodIntelQsvMode)) normalized.vodIntelQsvMode = defaults.vodIntelQsvMode;
  normalized.vodSegmentSeconds = clampInt(normalized.vodSegmentSeconds, 2, 30, defaults.vodSegmentSeconds);
  normalized.vodStartupBufferSeconds = clampInt(normalized.vodStartupBufferSeconds, 1, 600, defaults.vodStartupBufferSeconds);
  if (!VOD_BUFFER_PROGRESSION_MODES.includes(normalized.vodBufferProgression)) normalized.vodBufferProgression = defaults.vodBufferProgression;
  normalized.vodAdaptiveBatchEnabled = Boolean(normalized.vodAdaptiveBatchEnabled);
  normalized.vodFixedBatchSegmentCount = clampInt(normalized.vodFixedBatchSegmentCount, 1, 100, defaults.vodFixedBatchSegmentCount);
  if (!VOD_QUALITY_MODES.includes(normalized.vodQualityMode)) normalized.vodQualityMode = defaults.vodQualityMode;
  normalized.vodCrf = clampInt(normalized.vodCrf, 16, 35, defaults.vodCrf);
  if (!VOD_BITRATE_MODES.includes(normalized.vodBitrateMode)) normalized.vodBitrateMode = defaults.vodBitrateMode;
  if (!VOD_AUDIO_MODES.includes(normalized.vodAudioMode)) normalized.vodAudioMode = defaults.vodAudioMode;
  return normalized;
}

function normalizeLanguageCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  return validLanguageCodes.has(normalized) ? normalized : DEFAULT_PREFERRED_LANGUAGE;
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}
