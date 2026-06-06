import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env, getTranscodeCacheDir } from "../config/env.js";
import { getEffectiveTranscodeBufferPreset } from "../settings/app-settings.js";
import type { BufferPreset, TranscodeQuality } from "../stremio/manifest.js";
import { getSelectedOriginal } from "../streams/original-store.js";
import { writeSystemLog } from "../system/system-log.js";
import { getTranscodeProfile, isBufferPreset, isTranscodeQuality } from "./transcode-profiles.js";

const vodParamsSchema = z.object({ streamId: z.string().min(1), quality: z.string() });
const vodSegmentParamsSchema = vodParamsSchema.extend({ segment: z.string().regex(/^segment_\d{5}\.ts$/) });

type VodSession = {
  id: string;
  streamId: string;
  quality: TranscodeQuality;
  bufferPreset: BufferPreset;
  originalUrl: string;
  durationSeconds: number;
  segmentSeconds: number;
  outputDir: string;
  playlistPath: string;
  createdAt: string;
};

const vodSessions = new Map<string, VodSession>();
const activeSegments = new Map<string, Promise<void>>();

export async function registerTranscodeVodRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { streamId: string; quality: string }; Querystring: { buffer?: string } }>(
    "/transcode-vod/:streamId/:quality/master.m3u8",
    async (request, reply) => {
      const params = vodParamsSchema.safeParse(request.params);
      if (!params.success || !isTranscodeQuality(params.data.quality)) {
        reply.code(400);
        return { error: "Invalid VOD transcode request.", details: params.success ? "Invalid transcode quality." : params.error.flatten() };
      }

      const original = getSelectedOriginal(params.data.streamId);
      if (!original?.originalUrl) {
        reply.code(404);
        return { error: "Selected original stream was not found or has expired." };
      }

      const bufferPreset = resolveBufferPreset(request.query.buffer);
      const session = await getOrCreateVodSession(params.data.streamId, params.data.quality, bufferPreset, original.originalUrl);
      reply.header("content-type", "application/vnd.apple.mpegurl");
      reply.header("cache-control", "no-store");
      return createReadStream(session.playlistPath);
    }
  );

  app.get<{ Params: { streamId: string; quality: string; segment: string }; Querystring: { buffer?: string } }>(
    "/transcode-vod/:streamId/:quality/:segment",
    async (request, reply) => {
      const params = vodSegmentParamsSchema.safeParse(request.params);
      if (!params.success || !isTranscodeQuality(params.data.quality)) {
        reply.code(400);
        return { error: "Invalid VOD segment request.", details: params.success ? "Invalid transcode quality." : params.error.flatten() };
      }

      const original = getSelectedOriginal(params.data.streamId);
      if (!original?.originalUrl) {
        reply.code(404);
        return { error: "Selected original stream was not found or has expired." };
      }

      const bufferPreset = resolveBufferPreset(request.query.buffer);
      const session = await getOrCreateVodSession(params.data.streamId, params.data.quality, bufferPreset, original.originalUrl);
      const segmentPath = join(session.outputDir, params.data.segment);
      if (!existsSync(segmentPath)) {
        await generateVodSegment(session, params.data.segment);
      }

      if (!existsSync(segmentPath)) {
        reply.code(503);
        return { error: "VOD segment was not generated." };
      }

      reply.header("content-type", "video/mp2t");
      reply.header("cache-control", "public, max-age=300");
      return createReadStream(segmentPath);
    }
  );
}

async function getOrCreateVodSession(streamId: string, quality: TranscodeQuality, bufferPreset: BufferPreset, originalUrl: string): Promise<VodSession> {
  const profile = getTranscodeProfile(quality, bufferPreset);
  const sessionId = Buffer.from(`${streamId}|${quality}|${bufferPreset}|vod`).toString("base64url");
  const existing = vodSessions.get(sessionId);
  if (existing) return existing;

  const durationSeconds = await probeDurationSeconds(originalUrl);
  const outputDir = join(getTranscodeCacheDir(), "vod", sessionId);
  mkdirSync(outputDir, { recursive: true });
  const session: VodSession = {
    id: sessionId,
    streamId,
    quality,
    bufferPreset,
    originalUrl,
    durationSeconds,
    segmentSeconds: profile.hlsSegmentSeconds,
    outputDir,
    playlistPath: join(outputDir, "master.m3u8"),
    createdAt: new Date().toISOString()
  };

  await Bun.write(session.playlistPath, buildVodPlaylist(session));
  vodSessions.set(sessionId, session);
  writeSystemLog("info", "transcode-vod", "VOD playlist prepared.", { streamId, quality, durationSeconds, segmentSeconds: session.segmentSeconds });
  return session;
}

function buildVodPlaylist(session: VodSession): string {
  const segmentCount = Math.max(1, Math.ceil(session.durationSeconds / session.segmentSeconds));
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${Math.ceil(session.segmentSeconds)}`, "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-INDEPENDENT-SEGMENTS"];
  for (let index = 0; index < segmentCount; index += 1) {
    const remaining = Math.max(0.1, session.durationSeconds - index * session.segmentSeconds);
    const duration = Math.min(session.segmentSeconds, remaining);
    lines.push(`#EXTINF:${duration.toFixed(3)},`, `segment_${String(index).padStart(5, "0")}.ts`);
  }
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

async function generateVodSegment(session: VodSession, segmentName: string): Promise<void> {
  const key = `${session.id}:${segmentName}`;
  const existing = activeSegments.get(key);
  if (existing) return existing;

  const promise = runVodSegmentFfmpeg(session, segmentName).finally(() => activeSegments.delete(key));
  activeSegments.set(key, promise);
  return promise;
}

async function runVodSegmentFfmpeg(session: VodSession, segmentName: string): Promise<void> {
  const segmentIndex = Number.parseInt(segmentName.match(/\d{5}/)?.[0] ?? "0", 10);
  const startSeconds = segmentIndex * session.segmentSeconds;
  const durationSeconds = Math.min(session.segmentSeconds, Math.max(0.1, session.durationSeconds - startSeconds));
  const outputPath = join(session.outputDir, segmentName);
  const profile = getTranscodeProfile(session.quality, session.bufferPreset);
  const args = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-ss",
    String(startSeconds),
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "5",
    "-i",
    session.originalUrl,
    "-t",
    String(durationSeconds),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-max_muxing_queue_size",
    "2048",
    "-vf",
    buildVideoFilter(profile.width, profile.height),
    "-c:v",
    "libx264",
    "-preset",
    profile.preset,
    "-crf",
    String(profile.crf),
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-g",
    "48",
    "-keyint_min",
    "48",
    "-sc_threshold",
    "0"
  ];

  if (profile.videoBitrateKbps) {
    args.push("-maxrate", `${profile.videoBitrateKbps}k`, "-bufsize", `${Math.round(profile.videoBitrateKbps * 2)}k`);
  }

  args.push("-c:a", "aac", "-b:a", `${profile.audioBitrateKbps}k`, "-ac", "2", "-f", "mpegts", outputPath);
  await runProcess(env.FFMPEG_PATH, args);
  writeSystemLog("info", "transcode-vod", "VOD segment generated.", { streamId: session.streamId, quality: session.quality, segmentName, startSeconds, durationSeconds });
}

function buildVideoFilter(width?: number, height?: number): string {
  const filters: string[] = [];
  if (width && height) filters.push(`scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`);
  filters.push("format=yuv420p");
  return filters.join(",");
}

async function probeDurationSeconds(originalUrl: string): Promise<number> {
  const ffprobePath = env.FFMPEG_PATH.endsWith("ffmpeg") ? env.FFMPEG_PATH.replace(/ffmpeg$/, "ffprobe") : "ffprobe";
  const output = await execFileText(ffprobePath, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", originalUrl], 30000);
  const duration = Number.parseFloat(output.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not read source duration with ffprobe.");
  return duration;
}

function execFileText(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr?.toString() || error.message));
      else resolve(stdout.toString());
    });
  });
}

function runProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "pipe" });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); stderr = stderr.slice(-4000); });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `Process exited with code ${code}${signal ? `, signal ${signal}` : ""}.`));
    });
  });
}

function resolveBufferPreset(value: string | undefined): BufferPreset {
  const requested = value ?? "";
  if (isBufferPreset(requested)) return requested;
  const setting = getEffectiveTranscodeBufferPreset();
  return isBufferPreset(setting) ? setting : "auto";
}
