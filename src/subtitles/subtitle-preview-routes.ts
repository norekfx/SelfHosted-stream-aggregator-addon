import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeSystemLog } from "../system/system-log.js";

const previewQuerySchema = z.object({
  url: z.string().url()
});

const MAX_PREVIEW_BYTES = 256 * 1024;
const PREVIEW_TIMEOUT_MS = 12000;

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);

  writeSystemLog("info", "animesub", "Subtitle preview fetch started.", { url });

  try {
    const response = await fetch(url, {
      headers: { accept: "text/vtt,text/plain,application/x-subrip,*/*" },
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`Subtitle preview failed with HTTP ${response.status}.`);

    const contentType = response.headers.get("content-type") ?? undefined;
    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : undefined;
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const truncated = bytes.byteLength > MAX_PREVIEW_BYTES;
    const previewBytes = truncated ? bytes.slice(0, MAX_PREVIEW_BYTES) : bytes;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(previewBytes);
    const format = inferSubtitleFormat(url, contentType, text);

    writeSystemLog("info", "animesub", "Subtitle preview fetch completed.", {
      url,
      format,
      contentType,
      contentLength,
      bytesRead: bytes.byteLength,
      truncated,
      responseTimeMs: Date.now() - startedAt
    });

    return {
      url,
      format,
      contentType,
      contentLength: Number.isFinite(contentLength) ? contentLength : bytes.byteLength,
      bytesRead: bytes.byteLength,
      truncated,
      responseTimeMs: Date.now() - startedAt,
      previewText: text
    };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? `Subtitle preview timed out after ${PREVIEW_TIMEOUT_MS}ms.`
      : error instanceof Error
        ? error.message
        : "Unknown subtitle preview error.";
    writeSystemLog("warn", "animesub", "Subtitle preview fetch failed.", { url, error: message, responseTimeMs: Date.now() - startedAt });
    return { url, error: message, format: inferSubtitleFormat(url), previewText: "" };
  } finally {
    clearTimeout(timeout);
  }
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
