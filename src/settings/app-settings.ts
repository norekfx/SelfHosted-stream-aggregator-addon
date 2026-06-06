import { getDatabase } from "../db/database.js";
import { DEFAULT_PREFERRED_LANGUAGE } from "../languages/european-languages.js";
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
      const value = input[key];
      if (value === undefined) {
        continue;
      }

      statement.run(key, String(value), now);
    }
  });

  transaction();
  return getAppSettings();
}
