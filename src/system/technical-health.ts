import { accessSync, constants, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { env, getDatabasePath, getTranscodeCacheDir } from "../config/env.js";
import { getDatabase } from "../db/database.js";
import { getAppSettings } from "../settings/app-settings.js";
import { getAddonManifest } from "../stremio/manifest.js";

export type TechnicalHealthCheck = {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  details?: Record<string, unknown>;
};

export type TechnicalHealthReport = {
  status: "ok" | "warn" | "error";
  checkedAt: string;
  checks: TechnicalHealthCheck[];
};

export async function runTechnicalHealthCheck(): Promise<TechnicalHealthReport> {
  const checks: TechnicalHealthCheck[] = [];
  checks.push(checkSqlite());
  checks.push(checkDataDirectories());
  checks.push(checkManifest());
  checks.push(checkPublicUrl());
  checks.push(await checkFfmpeg());

  const status = checks.some((check) => check.status === "error")
    ? "error"
    : checks.some((check) => check.status === "warn")
      ? "warn"
      : "ok";

  return {
    status,
    checkedAt: new Date().toISOString(),
    checks
  };
}

function checkSqlite(): TechnicalHealthCheck {
  try {
    const row = getDatabase().prepare("SELECT 1 as ok").get() as { ok: number };
    return {
      name: "SQLite",
      status: row.ok === 1 ? "ok" : "error",
      message: row.ok === 1 ? "Database is reachable." : "Database check returned unexpected result.",
      details: { path: getDatabasePath() }
    };
  } catch (error) {
    return {
      name: "SQLite",
      status: "error",
      message: error instanceof Error ? error.message : "Database check failed.",
      details: { path: getDatabasePath() }
    };
  }
}

function checkDataDirectories(): TechnicalHealthCheck {
  try {
    mkdirSync(dirname(getDatabasePath()), { recursive: true });
    mkdirSync(getTranscodeCacheDir(), { recursive: true });
    accessSync(dirname(getDatabasePath()), constants.R_OK | constants.W_OK);
    accessSync(getTranscodeCacheDir(), constants.R_OK | constants.W_OK);
    return {
      name: "Data directories",
      status: "ok",
      message: "Database and transcode cache directories are writable.",
      details: { databaseDir: dirname(getDatabasePath()), transcodeCacheDir: getTranscodeCacheDir() }
    };
  } catch (error) {
    return {
      name: "Data directories",
      status: "error",
      message: error instanceof Error ? error.message : "Data directory check failed.",
      details: { databaseDir: dirname(getDatabasePath()), transcodeCacheDir: getTranscodeCacheDir() }
    };
  }
}

function checkManifest(): TechnicalHealthCheck {
  const addonManifest = getAddonManifest();
  const hasStreams = addonManifest.resources.includes("stream") && addonManifest.types.includes("movie") && addonManifest.types.includes("series");
  return {
    name: "Manifest",
    status: hasStreams ? "ok" : "error",
    message: hasStreams ? "Manifest exposes stream resource for movie and series." : "Manifest is missing required stream resources.",
    details: { id: addonManifest.id, version: addonManifest.version }
  };
}

function checkPublicUrl(): TechnicalHealthCheck {
  const settings = getAppSettings();
  const value = settings.publicBaseUrl ?? env.PUBLIC_BASE_URL;
  if (!value) {
    return {
      name: "Public URL",
      status: "warn",
      message: "Public URL is not configured. Local playback may work, but remote Stremio/Nuvio access needs a public HTTPS URL."
    };
  }

  return {
    name: "Public URL",
    status: value.startsWith("https://") ? "ok" : "warn",
    message: value.startsWith("https://") ? "Public URL is configured with HTTPS." : "Public URL is configured, but HTTPS is recommended.",
    details: { publicBaseUrl: value }
  };
}

function checkFfmpeg(): Promise<TechnicalHealthCheck> {
  return new Promise((resolve) => {
    const child = spawn(env.FFMPEG_PATH, ["-version"], { stdio: "pipe" });
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        name: "FFmpeg",
        status: "error",
        message: error.message,
        details: { ffmpegPath: env.FFMPEG_PATH }
      });
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve({
          name: "FFmpeg",
          status: "ok",
          message: "FFmpeg is available.",
          details: { ffmpegPath: env.FFMPEG_PATH, version: output.split("\n")[0] }
        });
        return;
      }

      resolve({
        name: "FFmpeg",
        status: "error",
        message: `FFmpeg exited with code ${code}.`,
        details: { ffmpegPath: env.FFMPEG_PATH }
      });
    });
  });
}
