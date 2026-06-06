import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { getSelectedOriginal } from "../streams/original-store.js";
import { isBufferPreset, isTranscodeQuality } from "./transcode-profiles.js";
import { getOrCreateTranscodeSession, getTranscodeSession } from "./transcode-session.js";

const playlistParamsSchema = z.object({
  streamId: z.string().min(1),
  quality: z.string().refine(isTranscodeQuality, "Invalid transcode quality")
});

const segmentParamsSchema = playlistParamsSchema.extend({
  segment: z.string().regex(/^segment_\d{5}\.ts$/)
});

export async function registerTranscodeRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { streamId: string; quality: string }; Querystring: { buffer?: string } }>(
    "/transcode/:streamId/:quality/master.m3u8",
    async (request, reply) => {
      const params = playlistParamsSchema.safeParse(request.params);
      if (!params.success) {
        reply.code(400);
        return { error: "Invalid transcode request.", details: params.error.flatten() };
      }

      const bufferPreset = isBufferPreset(request.query.buffer ?? "")
        ? request.query.buffer
        : isBufferPreset(env.DEFAULT_TRANSCODE_BUFFER_PRESET)
          ? env.DEFAULT_TRANSCODE_BUFFER_PRESET
          : "auto";

      const original = getSelectedOriginal(params.data.streamId);
      if (!original) {
        reply.code(404);
        return { error: "Selected original stream was not found or has expired." };
      }

      const session = getOrCreateTranscodeSession(original, params.data.quality, bufferPreset);
      if (!existsSync(session.playlistPath)) {
        reply.code(202);
        return {
          status: session.status,
          message: "Transcode session is starting. Retry this playlist shortly.",
          sessionId: session.id,
          bufferPreset: session.bufferPreset,
          error: session.error
        };
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
      if (!params.success) {
        reply.code(400);
        return { error: "Invalid transcode segment request.", details: params.error.flatten() };
      }

      const bufferPreset = isBufferPreset(request.query.buffer ?? "")
        ? request.query.buffer
        : isBufferPreset(env.DEFAULT_TRANSCODE_BUFFER_PRESET)
          ? env.DEFAULT_TRANSCODE_BUFFER_PRESET
          : "auto";

      const sessionId = Buffer.from(`${params.data.streamId}|${params.data.quality}|${bufferPreset}`).toString("base64url");
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
