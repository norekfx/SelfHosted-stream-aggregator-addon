import type { StreamValidationInput, StreamValidationResult } from "./stream-validation.js";

const DEFAULT_TIMEOUT_MS = 10000;
const RANGE_HEADER_VALUE = "bytes=0-1023";
const SUPPORTED_URL_PROTOCOLS = new Set(["http:", "https:"]);

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
    return head;
  }

  const rangeGet = await requestWithTimeout(parsedUrl, "RANGE_GET", timeoutMs);
  if (rangeGet.status === "working") {
    return rangeGet;
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
