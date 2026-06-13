import { createReadStream, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEffectiveTranscodeBufferPreset } from "../settings/app-settings.js";
import type { BufferPreset } from "../stremio/manifest.js";
import { getSelectedOriginal } from "../streams/original-store.js";
import { writeSystemLog } from "../system/system-log.js";
import { isBufferPreset, isTranscodeQuality } from "./transcode-profiles.js";
import { listVodTranscodeSessions } from "./transcode-vod-routes.js";
import { createTranscodeSessionId, getOrCreateTranscodeSession, getTranscodeSession, listTranscodeSessions, stopTranscodeSession } from "./transcode-session.js";

const playlistParamsSchema = z.object({
  streamId: z.string().min(1),
  quality: z.string()
});

const segmentParamsSchema = playlistParamsSchema.extend({
  segment: z.string().regex(/^segment_\d{5}\.ts$/)
});

const stopParamsSchema = z.object({ sessionId: z.string().min(1) });

export async function registerTranscodeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/transcode/sessions", async () => ({ sessions: [...listTranscodeSessions().map((session) => ({ ...session, mode: "live" })), ...listVodTranscodeSessions()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 50) }));

  app.post<{ Params: { sessionId: string } }>("/transcode/sessions/:sessionId/stop", async (request, reply) => {
    const params = stopParamsSchema.safeParse(request.params);
    if (!params.success) {
      reply.code(400);
      return { error: "Invalid transcode session id.", details: params.error.flatten() };
    }

    const session = stopTranscodeSession(params.data.sessionId, "stopped from system panel");
    if (session) return { session };

    const vodSession = listVodTranscodeSessions().find((item) => item.id === params.data.sessionId);
    if (vodSession) {
      const killed = await stopFfmpegProcessForSession(params.data.sessionId);
      writeSystemLog(killed ? "info" : "warn", "transcode-vod", killed ? "VOD transcode stop requested." : "VOD transcode stop requested, but no matching FFmpeg process was found.", { sessionId: params.data.sessionId, streamId: vodSession.streamId, quality: vodSession.quality });
      return { session: { ...vodSession, status: killed ? "exited" : vodSession.status, stopReason: "stopped from system panel" } };
    }

    reply.code(404);
    return { error: "Transcode session not found." };
  });

  app.get<{ Params: { streamId: string; quality: string }; Querystring: { buffer?: string } }>(
    "/transcode/:streamId/:quality/master.m3u8",
    async (request, reply) => {
      const params = playlistParamsSchema.safeParse(request.params);
      if (!params.success || !isTranscodeQuality(params.data.quality)) {
        reply.code(400);
        return { error: "Invalid transcode request.", details: params.success ? "Invalid transcode quality." : params.error.flatten() };
      }

      const bufferPreset = resolveBufferPreset(request.query.buffer);
      const original = getSelectedOriginal(params.data.streamId);
      if (!original) {
        reply.code(404);
        return { error: "Selected original stream was not found or has expired." };
      }

      const session = getOrCreateTranscodeSession(original, params.data.quality, bufferPreset);
      const playlistReady = await waitForPlaylist(session.playlistPath, 12_000);
      if (!playlistReady) {
        writeSystemLog("warn", "transcode", "Playlist was not ready before the player timeout.", {
          sessionId: session.id,
          streamId: session.streamId,
          quality: session.quality,
          status: session.status,
          speed: session.progress?.speed,
          fps: session.progress?.fps,
          error: session.error
        });
        reply.code(session.status === "failed" ? 500 : 503);
        reply.header("content-type", "application/vnd.apple.mpegurl");
        reply.header("cache-control", "no-store");
        return "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-ENDLIST\n";
      }

      reply.header("content-type", "application/vnd.apple.mpegurl");
      reply.header("cache-control", "no-store");
      return createReadStream(session.playlistPath);
    }
  );

  app.get<{ Params: { streamId: string; quality: string; segment: string }; Querystring: { buffer?: string } }>(
    "/transcode/:streamId/:quality/:segment",
    async (request, reply) => {
      const params = segmentParamsSchema.safeParse(request.params);
      if (!params.success || !isTranscodeQuality(params.data.quality)) {
        reply.code(400);
        return { error: "Invalid transcode segment request.", details: params.success ? "Invalid transcode quality." : params.error.flatten() };
      }

      const bufferPreset = resolveBufferPreset(request.query.buffer);
      const sessionId = createTranscodeSessionId(params.data.streamId, params.data.quality, bufferPreset);
      const session = getTranscodeSession(sessionId);
      if (!session) {
        reply.code(404);
        return { error: "Transcode session not found." };
      }

      const segmentPath = join(session.outputDir, params.data.segment);
      if (!existsSync(segmentPath)) {
        reply.code(404);
        return { error: "Transcode segment not ready." };
      }

      reply.header("content-type", "video/mp2t");
      reply.header("cache-control", "public, max-age=30");
      return createReadStream(segmentPath);
    }
  );
}

function resolveBufferPreset(value: string | undefined): BufferPreset {
  const requested = value ?? "";
  if (isBufferPreset(requested)) {
    return requested;
  }

  const setting = getEffectiveTranscodeBufferPreset();
  return isBufferPreset(setting) ? setting : "auto";
}

async function stopFfmpegProcessForSession(sessionId: string): Promise<boolean> {
  const safeSessionId = sessionId.replace(/[^A-Za-z0-9_-]/g, "");
  if (!safeSessionId) return false;
  return new Promise((resolve) => {
    execFile("pkill", ["-TERM", "-f", safeSessionId], { timeout: 5_000 }, (error) => {
      resolve(!error);
    });
  });
}

async function waitForPlaylist(path: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(path)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}
