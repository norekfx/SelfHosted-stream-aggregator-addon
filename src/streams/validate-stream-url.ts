import { execFile } from "node:child_process";
import { env } from "../config/env.js";
import { getAppSettings } from "../settings/app-settings.js";
import type { StreamValidationInput, StreamValidationResult } from "./stream-validation.js";

const DEFAULT_TIMEOUT_MS = 10000;
const RANGE_HEADER_VALUE = "bytes=0-1023";
const SUPPORTED_URL_PROTOCOLS = new Set(["http:", "https:"]);
const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

export async function validateStream(input: StreamValidationInput, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<StreamValidationResult> {
  const candidateUrl = input.url ?? input.externalUrl;

  if (!candidateUrl && input.infoHash) {
    return skipped("Torrent infoHash streams require a resolver/debrid step before HTTP validation.");
  }

  if (!candidateUrl) {
    return failed("Stream has no URL, externalUrl or resolvable infoHash.", "SKIPPED");
  }

  const parsedUrl = safeParseUrl(candidateUrl);
  if (!parsedUrl || !SUPPORTED_URL_PROTOCOLS.has(parsedUrl.protocol)) {
    return failed("Stream URL must use http or https.", "SKIPPED");
  }

  const head = await requestWithTimeout(parsedUrl, "HEAD", timeoutMs);
  if (head.status === "working") {
    return checkDebridPlaceholder(parsedUrl, input, head, timeoutMs);
  }

  const rangeGet = await requestWithTimeout(parsedUrl, "RANGE_GET", timeoutMs);
  if (rangeGet.status === "working") {
    return checkDebridPlaceholder(parsedUrl, input, rangeGet, timeoutMs);
  }

  return {
    ...rangeGet,
    reason: rangeGet.reason ?? head.reason ?? "Stream validation failed."
  };
}

async function requestWithTimeout(url: URL, method: "HEAD" | "RANGE_GET", timeoutMs: number): Promise<StreamValidationResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: method === "HEAD" ? "HEAD" : "GET",
      headers: method === "RANGE_GET" ? { range: RANGE_HEADER_VALUE } : undefined,
      redirect: "follow",
      signal: controller.signal
    });

    const contentType = response.headers.get("content-type") ?? undefined;
    const contentLength = parseContentLength(response.headers.get("content-length"));
    const acceptsRanges = /bytes/i.test(response.headers.get("accept-ranges") ?? "");
    const responseTimeMs = Date.now() - startedAt;

    if (isWorkingHttpStatus(response.status)) {
      return {
        status: "working",
        method,
        checkedAt: new Date().toISOString(),
        responseTimeMs,
        httpStatus: response.status,
        contentType,
        contentLength,
        acceptsRanges,
        finalUrl: response.url
      };
    }

    return {
      status: "failed",
      method,
      checkedAt: new Date().toISOString(),
      responseTimeMs,
      httpStatus: response.status,
      contentType,
      contentLength,
      acceptsRanges,
      finalUrl: response.url,
      reason: `HTTP ${response.status} during ${method}.`
    };
  } catch (error) {
    return {
      status: "failed",
      method,
      checkedAt: new Date().toISOString(),
      responseTimeMs: Date.now() - startedAt,
      reason: error instanceof Error && error.name === "AbortError"
        ? `${method} validation timed out after ${timeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : "Unknown validation error."
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkDebridPlaceholder(url: URL, input: StreamValidationInput, result: StreamValidationResult, timeoutMs: number): Promise<StreamValidationResult> {
  const settings = getAppSettings();
  if (!settings.detectDebridPlaceholders || !input.isDebrid) return result;

  const minSizeBytes = settings.debridPlaceholderMinSizeMb * MB;
  if (result.contentLength !== undefined && result.contentLength < minSizeBytes) {
    return {
      ...result,
      status: "failed",
      reason: `Debrid placeholder suspected: real file size ${formatBytes(result.contentLength)} is below configured minimum ${settings.debridPlaceholderMinSizeMb} MB.`
    };
  }

  if (settings.debridPlaceholderCompareDeclaredSize && result.contentLength !== undefined) {
    const declaredBytes = parseDeclaredSizeBytes(input.declaredSize ?? input.rawText ?? "");
    const allowedDifferenceBytes = settings.debridPlaceholderSizeDifferenceGb * GB;
    if (declaredBytes !== undefined && declaredBytes - result.contentLength > allowedDifferenceBytes) {
      return {
        ...result,
        status: "failed",
        reason: `Debrid placeholder suspected: real file size ${formatBytes(result.contentLength)} differs from declared size ${formatBytes(declaredBytes)} by more than ${settings.debridPlaceholderSizeDifferenceGb} GB.`
      };
    }
  }

  const durationSeconds = await probeDurationSeconds(url.toString(), Math.min(Math.max(timeoutMs, 5000), 30000));
  if (durationSeconds !== undefined) {
    const minDurationSeconds = settings.debridPlaceholderMinDurationMinutes * 60;
    if (durationSeconds < minDurationSeconds) {
      return {
        ...result,
        status: "failed",
        method: "FFPROBE",
        durationSeconds,
        reason: `Debrid placeholder suspected: video duration ${Math.round(durationSeconds)}s is below configured minimum ${settings.debridPlaceholderMinDurationMinutes} min.`
      };
    }

    return { ...result, durationSeconds };
  }

  return result;
}

function isWorkingHttpStatus(status: number): boolean {
  return (status >= 200 && status < 300) || status === 206;
}

function safeParseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDeclaredSizeBytes(value: string): number | undefined {
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*(gb|gib|mb|mib)\b/i);
  if (!match) return undefined;
  const amount = Number.parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(amount)) return undefined;
  const unit = match[2].toLowerCase();
  return unit.startsWith("g") ? Math.round(amount * GB) : Math.round(amount * MB);
}

function formatBytes(value: number): string {
  if (value >= GB) return `${(value / GB).toFixed(2)} GB`;
  return `${(value / MB).toFixed(2)} MB`;
}

function probeDurationSeconds(url: string, timeoutMs: number): Promise<number | undefined> {
  const ffprobePath = env.FFMPEG_PATH.endsWith("ffmpeg") ? env.FFMPEG_PATH.replace(/ffmpeg$/, "ffprobe") : "ffprobe";
  return new Promise((resolve) => {
    execFile(ffprobePath, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", url], { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve(undefined);
      const duration = Number.parseFloat(stdout.toString().trim());
      resolve(Number.isFinite(duration) && duration > 0 ? duration : undefined);
    });
  });
}

function skipped(reason: string): StreamValidationResult {
  return {
    status: "unsupported",
    method: "SKIPPED",
    checkedAt: new Date().toISOString(),
    reason
  };
}

function failed(reason: string, method: StreamValidationResult["method"]): StreamValidationResult {
  return {
    status: "failed",
    method,
    checkedAt: new Date().toISOString(),
    reason
  };
}
