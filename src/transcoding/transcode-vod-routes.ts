import { createReadStream, existsSync, mkdirSync, readdirSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env, getTranscodeCacheDir } from "../config/env.js";
import { getEffectiveMaxTranscodeSessions, getEffectiveTranscodeBufferPreset } from "../settings/app-settings.js";
import type { BufferPreset, TranscodeQuality } from "../stremio/manifest.js";
import { getSelectedOriginal } from "../streams/original-store.js";
import type { AggregatedStream } from "../streams/types.js";
import { writeSystemLog } from "../system/system-log.js";
import { getTranscodeProfile, isBufferPreset, isTranscodeQuality } from "./transcode-profiles.js";
import { stopActiveTranscodeSessions, type TranscodeSpeedStats } from "./transcode-session.js";

const vodParamsSchema = z.object({ streamId: z.string().min(1), quality: z.string() });
const vodSegmentParamsSchema = vodParamsSchema.extend({ segment: z.string().regex(/^segment_\d{5}\.ts$/) });

type VodProgress = { frame?: number; fps?: number; bitrate?: string; outTime?: string; speed?: string; progress?: string };
type VodStatus = "starting" | "running" | "exited" | "failed";
type VodSession = { id: string; streamId: string; title?: string; sourceAddon?: string; sourceQuality?: string; quality: TranscodeQuality; bufferPreset: BufferPreset; originalUrl: string; durationSeconds: number; segmentSeconds: number; targetBufferSeconds: number; outputDir: string; playlistPath: string; createdAt: string; updatedAt: string; status: VodStatus; error?: string; lastLog?: string; activeSegment?: string; progress?: VodProgress; speedStats?: TranscodeSpeedStats; activeProcess?: ChildProcessWithoutNullStreams };

const vodSessions = new Map<string, VodSession>();
const activeSegments = new Map<string, Promise<void>>();
const sessionQueues = new Map<string, Promise<void>>();

export function listVodTranscodeSessions(): Array<any> {
  return Array.from(vodSessions.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map((session) => {
    const profile = getTranscodeProfile(session.quality, session.bufferPreset);
    const segmentCount = countGeneratedSegments(session);
    const queued = Array.from(activeSegments.keys()).filter((key) => key.startsWith(`${session.id}:`)).length;
    const { activeProcess: _activeProcess, ...snapshot } = session;
    return { ...snapshot, mode: "vod", modeLabel: "VOD HLS seek", startedAt: session.createdAt, queuedSegments: queued, buffer: { segmentCount, estimatedSeconds: segmentCount * session.segmentSeconds, segmentSeconds: session.segmentSeconds, targetSeconds: session.targetBufferSeconds }, profile };
  });
}

export async function registerTranscodeVodRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { streamId: string; quality: string }; Querystring: { buffer?: string } }>("/transcode-vod/:streamId/:quality/master.m3u8", async (request, reply) => {
    const params = vodParamsSchema.safeParse(request.params);
    if (!params.success || !isTranscodeQuality(params.data.quality)) { reply.code(400); return { error: "Invalid VOD transcode request.", details: params.success ? "Invalid transcode quality." : params.error.flatten() }; }
    const original = getSelectedOriginal(params.data.streamId);
    if (!original?.originalUrl) { reply.code(404); return { error: "Selected original stream was not found or has expired." }; }
    const bufferPreset = resolveBufferPreset(request.query.buffer);
    try {
      prepareExclusiveVodTranscode();
      const session = await getOrCreateVodSession(params.data.streamId, params.data.quality, bufferPreset, original);
      await ensureVodStartupBuffer(session);
      prewarmVodSegments(session, getStartupSegmentCount(session), getVodBatchSegmentCount(session));
      reply.header("content-type", "application/vnd.apple.mpegurl");
      reply.header("cache-control", "no-store");
      return createReadStream(session.playlistPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not prepare VOD playlist.";
      writeSystemLog("error", "transcode-vod", message, { streamId: params.data.streamId, quality: params.data.quality });
      reply.code(500);
      return { error: message };
    }
  });

  app.get<{ Params: { streamId: string; quality: string; segment: string }; Querystring: { buffer?: string } }>("/transcode-vod/:streamId/:quality/:segment", async (request, reply) => {
    const params = vodSegmentParamsSchema.safeParse(request.params);
    if (!params.success || !isTranscodeQuality(params.data.quality)) { reply.code(400); return { error: "Invalid VOD segment request.", details: params.success ? "Invalid transcode quality." : params.error.flatten() }; }
    const original = getSelectedOriginal(params.data.streamId);
    if (!original?.originalUrl) { reply.code(404); return { error: "Selected original stream was not found or has expired." }; }
    const bufferPreset = resolveBufferPreset(request.query.buffer);
    try {
      const session = await getOrCreateVodSession(params.data.streamId, params.data.quality, bufferPreset, original);
      const segmentPath = join(session.outputDir, params.data.segment);
      if (!existsSync(segmentPath)) await generateVodSegment(session, params.data.segment);
      if (!existsSync(segmentPath)) { reply.code(503); return { error: "VOD segment was not generated." }; }
      const segmentIndex = parseSegmentIndex(params.data.segment);
      prewarmVodSegments(session, segmentIndex + 1, getVodBatchSegmentCount(session));
      reply.header("content-type", "video/mp2t");
      reply.header("cache-control", "public, max-age=300");
      return createReadStream(segmentPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not generate VOD segment.";
      const session = Array.from(vodSessions.values()).find((item) => item.streamId === params.data.streamId && item.quality === params.data.quality);
      if (session) { session.status = "failed"; session.error = message; session.updatedAt = new Date().toISOString(); }
      writeSystemLog("error", "transcode-vod", message, { streamId: params.data.streamId, quality: params.data.quality, segment: params.data.segment });
      reply.code(500);
      return { error: message };
    }
  });
}

async function getOrCreateVodSession(streamId: string, quality: TranscodeQuality, bufferPreset: BufferPreset, original: AggregatedStream): Promise<VodSession> {
  const profile = getTranscodeProfile(quality, bufferPreset);
  const sessionId = Buffer.from(`${streamId}|${quality}|${bufferPreset}|vod`).toString("base64url");
  const existing = vodSessions.get(sessionId);
  if (existing) return existing;
  const durationSeconds = await probeDurationSeconds(original.originalUrl ?? "");
  const outputDir = join(getTranscodeCacheDir(), "vod", sessionId);
  mkdirSync(outputDir, { recursive: true });
  const now = new Date().toISOString();
  const session: VodSession = { id: sessionId, streamId, title: original.title || original.name, sourceAddon: original.sourceAddon, sourceQuality: original.quality, quality, bufferPreset, originalUrl: original.originalUrl ?? "", durationSeconds, segmentSeconds: profile.hlsSegmentSeconds, targetBufferSeconds: getTargetBufferSeconds(bufferPreset), outputDir, playlistPath: join(outputDir, "master.m3u8"), createdAt: now, updatedAt: now, status: "starting", speedStats: { samples: 0 } };
  await writeFile(session.playlistPath, buildVodPlaylist(session), "utf-8");
  session.status = "exited";
  session.updatedAt = new Date().toISOString();
  vodSessions.set(sessionId, session);
  writeSystemLog("info", "transcode-vod", "VOD playlist prepared.", { streamId, quality, durationSeconds, segmentSeconds: session.segmentSeconds, targetBufferSeconds: session.targetBufferSeconds });
  return session;
}

function buildVodPlaylist(session: VodSession): string {
  const segmentCount = Math.max(1, Math.ceil(session.durationSeconds / session.segmentSeconds));
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${Math.ceil(session.segmentSeconds)}`, "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-MEDIA-SEQUENCE:0"];
  for (let index = 0; index < segmentCount; index += 1) {
    const remaining = Math.max(0.1, session.durationSeconds - index * session.segmentSeconds);
    const duration = Math.min(session.segmentSeconds, remaining);
    if (index > 0) lines.push("#EXT-X-DISCONTINUITY");
    lines.push(`#EXTINF:${duration.toFixed(3)},`, `segment_${String(index).padStart(5, "0")}.ts`);
  }
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

function prepareExclusiveVodTranscode(): void {
  if (getEffectiveMaxTranscodeSessions() !== 1) return;
  const stopped = stopActiveTranscodeSessions("VOD HLS seek requested while max transcode sessions is 1");
  if (stopped > 0) writeSystemLog("info", "transcode-vod", "Stopped active Live HLS transcode before starting VOD HLS seek.", { stopped });
}

async function ensureVodStartupBuffer(session: VodSession): Promise<void> {
  const requiredSegments = getStartupSegmentCount(session);
  if (requiredSegments > 0) await generateVodSegmentBatch(session, 0, requiredSegments);
  writeSystemLog("info", "transcode-vod", "VOD startup buffer is ready.", { streamId: session.streamId, quality: session.quality, requiredSegments, targetBufferSeconds: session.targetBufferSeconds });
}

function getStartupSegmentCount(session: VodSession): number {
  return Math.min(getSegmentCount(session), Math.max(1, Math.ceil(session.targetBufferSeconds / session.segmentSeconds)));
}

async function generateVodSegment(session: VodSession, segmentName: string): Promise<void> {
  const segmentIndex = parseSegmentIndex(segmentName);
  return generateVodSegmentBatch(session, segmentIndex, getVodBatchSegmentCount(session));
}

async function generateVodSegmentBatch(session: VodSession, startIndex: number, requestedCount: number): Promise<void> {
  const totalSegments = getSegmentCount(session);
  if (startIndex < 0 || startIndex >= totalSegments) return;

  const batchCount = Math.min(totalSegments - startIndex, Math.max(1, requestedCount));
  const plannedIndices = Array.from({ length: batchCount }, (_, offset) => startIndex + offset);
  const segmentKeys = plannedIndices.map((index) => `${session.id}:segment_${String(index).padStart(5, "0")}.ts`);
  const existing = segmentKeys.map((key) => activeSegments.get(key)).find(Boolean);
  if (existing) return existing;

  const missingIndices = plannedIndices.filter((index) => !existsSync(join(session.outputDir, `segment_${String(index).padStart(5, "0")}.ts`)));
  if (missingIndices.length === 0) return;

  const previous = sessionQueues.get(session.id) ?? Promise.resolve();
  const promise = previous.catch(() => undefined).then(async () => {
    const refreshedMissing = plannedIndices.filter((index) => !existsSync(join(session.outputDir, `segment_${String(index).padStart(5, "0")}.ts`)));
    if (refreshedMissing.length === 0) return;

    const firstMissingIndex = refreshedMissing[0] ?? startIndex;
    const lastPlannedIndex = plannedIndices.at(-1) ?? firstMissingIndex;
    const segmentCount = lastPlannedIndex - firstMissingIndex + 1;
    await runVodSegmentBatchFfmpeg(session, firstMissingIndex, segmentCount);
  }).finally(() => {
    for (const key of segmentKeys) activeSegments.delete(key);
  });

  for (const key of segmentKeys) activeSegments.set(key, promise);
  sessionQueues.set(session.id, promise.catch(() => undefined));
  return promise;
}

function prewarmVodSegments(session: VodSession, startIndex: number, count: number): void {
  if (startIndex < 0 || startIndex >= getSegmentCount(session)) return;
  generateVodSegmentBatch(session, startIndex, count).catch((error) => {
    const message = error instanceof Error ? error.message : "VOD prewarm failed.";
    session.error = message;
    session.status = "failed";
    session.updatedAt = new Date().toISOString();
    writeSystemLog("warn", "transcode-vod", "VOD segment prewarm failed.", { streamId: session.streamId, quality: session.quality, startIndex, count, error: message });
  });
}

async function runVodSegmentBatchFfmpeg(session: VodSession, startSegmentIndex: number, segmentCount: number): Promise<void> {
  const totalSegments = getSegmentCount(session);
  const safeStartIndex = Math.max(0, Math.min(startSegmentIndex, totalSegments - 1));
  const safeSegmentCount = Math.max(1, Math.min(segmentCount, totalSegments - safeStartIndex));
  const startSeconds = safeStartIndex * session.segmentSeconds;
  const durationSeconds = Math.min(session.segmentSeconds * safeSegmentCount, Math.max(0.1, session.durationSeconds - startSeconds));
  const firstSegmentName = `segment_${String(safeStartIndex).padStart(5, "0")}.ts`;
  const lastSegmentName = `segment_${String(safeStartIndex + safeSegmentCount - 1).padStart(5, "0")}.ts`;
  const tempPlaylistPath = join(session.outputDir, `batch_${String(safeStartIndex).padStart(5, "0")}_${Date.now()}.m3u8`);
  const profile = getTranscodeProfile(session.quality, session.bufferPreset);
  const args = ["-hide_banner", "-loglevel", "warning", "-progress", "pipe:2", "-fflags", "+genpts", "-ss", String(startSeconds), "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5", "-i", session.originalUrl, "-t", String(durationSeconds), "-map", "0:v:0", "-map", "0:a:0?", "-max_muxing_queue_size", "2048", "-avoid_negative_ts", "make_zero", "-muxdelay", "0", "-muxpreload", "0", "-vf", buildVideoFilter(profile.width, profile.height), "-c:v", "libx264", "-preset", profile.preset, "-crf", String(profile.crf), "-pix_fmt", "yuv420p", "-profile:v", "high", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0", "-force_key_frames", `expr:gte(t,n_forced*${session.segmentSeconds})`];
  if (profile.videoBitrateKbps) args.push("-maxrate", `${profile.videoBitrateKbps}k`, "-bufsize", `${Math.round(profile.videoBitrateKbps * 2)}k`);
  args.push("-c:a", "aac", "-b:a", `${profile.audioBitrateKbps}k`, "-ac", "2", "-f", "hls", "-hls_time", String(session.segmentSeconds), "-hls_list_size", "0", "-hls_flags", "independent_segments+temp_file", "-hls_segment_type", "mpegts", "-start_number", String(safeStartIndex), "-hls_segment_filename", join(session.outputDir, "segment_%05d.ts"), "-y", tempPlaylistPath);

  session.status = "running";
  session.activeSegment = safeSegmentCount === 1 ? firstSegmentName : `${firstSegmentName}..${lastSegmentName}`;
  session.updatedAt = new Date().toISOString();
  try {
    await runProcess(env.FFMPEG_PATH, args, session);
    if (!existsSync(join(session.outputDir, firstSegmentName))) throw new Error(`FFmpeg did not generate expected VOD segment ${firstSegmentName}.`);
  } finally {
    await rm(tempPlaylistPath, { force: true }).catch(() => undefined);
  }
  session.status = "exited";
  session.activeSegment = undefined;
  session.updatedAt = new Date().toISOString();
  writeSystemLog("info", "transcode-vod", "VOD segment batch generated.", { streamId: session.streamId, quality: session.quality, firstSegmentName, lastSegmentName, startSeconds, durationSeconds, segmentCount: safeSegmentCount, speed: session.progress?.speed, fps: session.progress?.fps });
}

function parseVodProgress(session: VodSession, text: string): void {
  const progress = session.progress ?? {};
  session.lastLog = text.slice(-2000);
  for (const line of text.split(/\r?\n/)) {
    const [key, value] = line.split("=", 2);
    if (!key || value === undefined) continue;
    if (key === "frame") progress.frame = Number.parseInt(value, 10);
    if (key === "fps") progress.fps = Number.parseFloat(value);
    if (key === "bitrate") progress.bitrate = value;
    if (key === "out_time") progress.outTime = value;
    if (key === "speed") { progress.speed = value; updateVodSpeedStats(session, value); }
    if (key === "progress") progress.progress = value;
  }
  session.progress = progress;
  session.updatedAt = new Date().toISOString();
}

function updateVodSpeedStats(session: VodSession, rawSpeed: string): void {
  const speed = Number.parseFloat(rawSpeed.replace(/x$/i, ""));
  if (!Number.isFinite(speed) || speed <= 0) return;
  const stats = session.speedStats ?? { samples: 0 };
  const samples = stats.samples + 1;
  const previousAverage = stats.average ?? speed;
  stats.samples = samples;
  stats.average = ((previousAverage * (samples - 1)) + speed) / samples;
  stats.min = stats.min === undefined ? speed : Math.min(stats.min, speed);
  stats.max = stats.max === undefined ? speed : Math.max(stats.max, speed);
  session.speedStats = stats;
}

function getTargetBufferSeconds(bufferPreset: BufferPreset): number {
  if (bufferPreset === "disabled") return 0;
  if (bufferPreset === "auto") return 20;
  const parsed = Number.parseInt(bufferPreset.replace(/s$/, ""), 10);
  return Number.isFinite(parsed) ? parsed : 20;
}

function getVodBatchSegmentCount(session: VodSession): number {
  const targetSegments = Math.ceil(session.targetBufferSeconds / session.segmentSeconds);
  const preferredSegments = Math.max(3, targetSegments);
  return Math.min(getSegmentCount(session), Math.max(1, preferredSegments));
}

function countGeneratedSegments(session: VodSession): number {
  try { return readdirSync(session.outputDir).filter((file) => /^segment_\d{5}\.ts$/.test(file)).length; } catch { return 0; }
}

function getSegmentCount(session: VodSession): number { return Math.max(1, Math.ceil(session.durationSeconds / session.segmentSeconds)); }
function parseSegmentIndex(segmentName: string): number { return Number.parseInt(segmentName.match(/\d{5}/)?.[0] ?? "0", 10); }
function buildVideoFilter(width?: number, height?: number): string { const filters: string[] = []; if (width && height) filters.push(`scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`); filters.push("format=yuv420p"); return filters.join(","); }
async function probeDurationSeconds(originalUrl: string): Promise<number> { const ffprobePath = env.FFMPEG_PATH.endsWith("ffmpeg") ? env.FFMPEG_PATH.replace(/ffmpeg$/, "ffprobe") : "ffprobe"; const output = await execFileText(ffprobePath, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", originalUrl], 30000); const duration = Number.parseFloat(output.trim()); if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not read source duration with ffprobe."); return duration; }
function execFileText(command: string, args: string[], timeoutMs: number): Promise<string> { return new Promise((resolve, reject) => { execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => { if (error) reject(new Error(stderr?.toString() || error.message)); else resolve(stdout.toString()); }); }); }
function runProcess(command: string, args: string[], session: VodSession): Promise<void> { return new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: "pipe" }); let stderr = ""; session.activeProcess = child; child.stderr.on("data", (chunk) => { const text = chunk.toString(); stderr += text; stderr = stderr.slice(-4000); parseVodProgress(session, text); }); child.on("error", reject); child.on("exit", (code, signal) => { session.activeProcess = undefined; if (code === 0) resolve(); else reject(new Error(stderr || `Process exited with code ${code}${signal ? `, signal ${signal}` : ""}.`)); }); }); }
function resolveBufferPreset(value: string | undefined): BufferPreset { const requested = value ?? ""; if (isBufferPreset(requested)) return requested; const setting = getEffectiveTranscodeBufferPreset(); return isBufferPreset(setting) ? setting : "auto"; }
