import http from "node:http";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeSystemLog } from "../system/system-log.js";

const previewQuerySchema = z.object({ url: z.string().url() });
const MAX_PREVIEW_BYTES = 256 * 1024;
const PREVIEW_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;

export async function registerSubtitlePreviewRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { url?: string } }>("/admin/animesub/subtitle-preview", async (request, reply) => {
    const query = previewQuerySchema.safeParse(request.query);
    if (!query.success) {
      reply.code(400);
      return { error: "Invalid subtitle preview URL.", details: query.error.flatten() };
    }
    return fetchSubtitlePreview(query.data.url);
  });
}

async function fetchSubtitlePreview(url: string) {
  const startedAt = Date.now();
  writeSystemLog("info", "animesub", "Subtitle preview fetch started.", { url });

  try {
    const result = await fetchSubtitleWithNativeFallback(url);
    const truncated = result.bytes.byteLength > MAX_PREVIEW_BYTES;
    const previewBytes = truncated ? result.bytes.slice(0, MAX_PREVIEW_BYTES) : result.bytes;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(previewBytes);
    const format = inferSubtitleFormat(result.finalUrl ?? url, result.contentType, text);
    const responseTimeMs = Date.now() - startedAt;

    writeSystemLog("info", "animesub", "Subtitle preview fetch completed.", {
      url,
      finalUrl: result.finalUrl,
      method: result.method,
      statusCode: result.statusCode,
      format,
      contentType: result.contentType,
      contentLength: result.contentLength,
      bytesRead: result.bytes.byteLength,
      truncated,
      responseTimeMs
    });

    return {
      url,
      finalUrl: result.finalUrl,
      method: result.method,
      statusCode: result.statusCode,
      format,
      contentType: result.contentType,
      contentLength: Number.isFinite(result.contentLength) ? result.contentLength : result.bytes.byteLength,
      bytesRead: result.bytes.byteLength,
      truncated,
      responseTimeMs,
      previewText: text
    };
  } catch (error) {
    const details = errorDetails(error);
    writeSystemLog("warn", "animesub", "Subtitle preview fetch failed.", { url, ...details, responseTimeMs: Date.now() - startedAt });
    return { url, error: details.message, errorName: details.name, errorCode: details.code, errorCause: details.cause, format: inferSubtitleFormat(url), previewText: "" };
  }
}

async function fetchSubtitleWithNativeFallback(url: string): Promise<PreviewFetchResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: previewHeaders(),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Subtitle preview failed with HTTP ${response.status}.`);
      const arrayBuffer = await response.arrayBuffer();
      const contentLengthHeader = response.headers.get("content-length");
      return {
        method: "fetch",
        finalUrl: response.url || url,
        statusCode: response.status,
        contentType: response.headers.get("content-type") ?? undefined,
        contentLength: contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : undefined,
        bytes: new Uint8Array(arrayBuffer)
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (fetchError) {
    writeSystemLog("warn", "animesub", "Subtitle preview fetch failed, retrying with native http client.", { url, ...errorDetails(fetchError) });
    return fetchWithNativeClient(url);
  }
}

function fetchWithNativeClient(url: string, redirects = 0): Promise<PreviewFetchResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "http:" ? http : https;
    const request = client.request(parsed, { method: "GET", headers: previewHeaders(), timeout: PREVIEW_TIMEOUT_MS }, (response) => {
      const statusCode = response.statusCode ?? 0;
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error(`Too many redirects while fetching subtitle preview.`));
        const nextUrl = new URL(location, parsed).toString();
        fetchWithNativeClient(nextUrl, redirects + 1).then(resolve, reject);
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on("end", () => reject(new Error(`Subtitle preview failed with HTTP ${statusCode}: ${Buffer.concat(chunks).toString("utf8").slice(0, 300)}`)));
        response.on("error", reject);
        return;
      }
      collectResponseBytes(response).then((bytes) => {
        const contentLengthHeader = response.headers["content-length"];
        const contentLength = Array.isArray(contentLengthHeader) ? Number.parseInt(contentLengthHeader[0] ?? "", 10) : contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : undefined;
        const contentTypeHeader = response.headers["content-type"];
        const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader.join(", ") : contentTypeHeader;
        resolve({ method: "native", finalUrl: url, statusCode, contentType, contentLength, bytes });
      }, reject);
    });
    request.on("timeout", () => request.destroy(new Error(`Subtitle preview timed out after ${PREVIEW_TIMEOUT_MS}ms.`)));
    request.on("error", reject);
    request.end();
  });
}

function collectResponseBytes(response: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    response.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      chunks.push(buffer);
      if (total > MAX_PREVIEW_BYTES * 4) response.destroy(new Error("Subtitle preview file is too large."));
    });
    response.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    response.on("error", reject);
  });
}

function previewHeaders(): Record<string, string> {
  return {
    accept: "text/vtt,text/plain,application/x-subrip,application/octet-stream,*/*",
    "accept-language": "pl,en;q=0.8",
    "user-agent": "Mozilla/5.0 (compatible; SelfHostedStreamAggregator/0.1; +https://github.com/norekfx/SelfHosted-stream-aggregator-addon)"
  };
}

function errorDetails(error: unknown): { name?: string; code?: string; message: string; cause?: string } {
  if (!(error instanceof Error)) return { message: String(error) };
  const cause = (error as Error & { cause?: unknown }).cause;
  const code = (error as Error & { code?: string }).code ?? (cause && typeof cause === "object" && "code" in cause ? String((cause as { code?: unknown }).code) : undefined);
  const causeMessage = cause instanceof Error ? cause.message : cause ? String(cause) : undefined;
  const message = error.name === "AbortError" ? `Subtitle preview timed out after ${PREVIEW_TIMEOUT_MS}ms.` : error.message;
  return { name: error.name, code, message, cause: causeMessage };
}

function inferSubtitleFormat(url: string, contentType?: string, text = ""): string {
  const cleanUrl = url.split("?")[0]?.toLowerCase() ?? url.toLowerCase();
  if (/\.vtt$/i.test(cleanUrl) || /webvtt/i.test(contentType ?? "") || /^WEBVTT\b/i.test(text.trim())) return "vtt";
  if (/\.srt$/i.test(cleanUrl) || /subrip/i.test(contentType ?? "") || /^\d+\s*\r?\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/m.test(text)) return "srt";
  if (/\.(ass|ssa)$/i.test(cleanUrl) || /\[Script Info\]/i.test(text) || /^Dialogue:/m.test(text)) return cleanUrl.endsWith(".ssa") ? "ssa" : "ass";
  if (/\.sub$/i.test(cleanUrl)) return "sub";
  if (/\.txt$/i.test(cleanUrl) || /^text\//i.test(contentType ?? "")) return "text";
  return "unknown";
}

type PreviewFetchResult = {
  method: "fetch" | "native";
  finalUrl: string;
  statusCode: number;
  contentType?: string;
  contentLength?: number;
  bytes: Uint8Array;
};
