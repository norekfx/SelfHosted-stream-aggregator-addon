import { getDatabase } from "../db/database.js";
import { DEFAULT_PREFERRED_LANGUAGE, EUROPEAN_LANGUAGES } from "../languages/european-languages.js";
import { env } from "../config/env.js";

export type AppSettings = {
  preferredAudioLanguage: string;
  preferredSubtitleLanguage: string;
  defaultTranscodeBufferPreset: string;
  streamValidationTimeoutMs: number;
  maxTranscodeSessions: number;
  publicBaseUrl?: string;
  autoRefreshCache: boolean;
  showDiagnosticDetails: boolean;
};

const validLanguageCodes = new Set(EUROPEAN_LANGUAGES.map((language) => language.code));

const defaults: AppSettings = {
  preferredAudioLanguage: DEFAULT_PREFERRED_LANGUAGE,
  preferredSubtitleLanguage: DEFAULT_PREFERRED_LANGUAGE,
  defaultTranscodeBufferPreset: env.DEFAULT_TRANSCODE_BUFFER_PRESET,
  streamValidationTimeoutMs: env.STREAM_VALIDATION_TIMEOUT_MS,
  maxTranscodeSessions: env.MAX_TRANSCODE_SESSIONS,
  publicBaseUrl: env.PUBLIC_BASE_URL,
  autoRefreshCache: true,
  showDiagnosticDetails: true
};

export function getAppSettings(): AppSettings {
  const rows = getDatabase()
    .prepare("SELECT key, value FROM app_settings")
    .all() as Array<{ key: keyof AppSettings; value: string }>;

  const settings = { ...defaults };
  for (const row of rows) {
    if (row.key === "streamValidationTimeoutMs" || row.key === "maxTranscodeSessions") {
      const parsed = Number.parseInt(row.value, 10);
      if (Number.isFinite(parsed)) {
        settings[row.key] = parsed;
      }
      continue;
    }

    if (row.key === "autoRefreshCache" || row.key === "showDiagnosticDetails") {
      settings[row.key] = row.value === "true";
      continue;
    }

    if (row.key === "publicBaseUrl" && row.value.trim() === "") {
      settings.publicBaseUrl = undefined;
      continue;
    }

    if (row.key === "preferredAudioLanguage" || row.key === "preferredSubtitleLanguage") {
      const value = normalizeLanguageCode(row.value);
      settings[row.key] = value;
      continue;
    }

    settings[row.key] = row.value as never;
  }

  return settings;
}

export function updateAppSettings(input: Partial<AppSettings>): AppSettings {
  const allowedKeys = Object.keys(defaults) as Array<keyof AppSettings>;
  const now = new Date().toISOString();
  const statement = getDatabase().prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  const transaction = getDatabase().transaction(() => {
    for (const key of allowedKeys) {
      let value = input[key];
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

export function getEffectiveMaxTranscodeSessions(): number {
  return getAppSettings().maxTranscodeSessions;
}

export function getEffectiveTranscodeBufferPreset(): string {
  return getAppSettings().defaultTranscodeBufferPreset;
}

function normalizeLanguageCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return DEFAULT_PREFERRED_LANGUAGE;

  // Early UI versions could accidentally submit Albanian because it was the first option.
  // Treat that accidental default as Polish unless the user later explicitly changes it in a fixed UI.
  if (normalized === "sq") return DEFAULT_PREFERRED_LANGUAGE;

  return validLanguageCodes.has(normalized) ? normalized : DEFAULT_PREFERRED_LANGUAGE;
}
