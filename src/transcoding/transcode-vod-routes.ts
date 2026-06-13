import { createReadStream, existsSync, mkdirSync, readdirSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env, getTranscodeCacheDir } from "../config/env.js";
import { getEffectiveMaxTranscodeSessions, getEffectiveTranscodeBufferPreset, getEffectiveTranscodeSettings, type VodTranscodeStrategy } from "../settings/app-settings.js";
import type { BufferPreset, TranscodeQuality } from "../stremio/manifest.js";
import { getSelectedOriginal } from "../streams/original-store.js";
import type { AggregatedStream } from "../streams/types.js";
import { writeSystemLog } from "../system/system-log.js";
import { getTranscodeProfile, isBufferPreset, isTranscodeQuality, type TranscodeProfile } from "./transcode-profiles.js";
import { applyVodAutoQualityLadder } from "./vod-quality-adapter.js";
import { stopActiveTranscodeSessions, type TranscodeSpeedStats } from "./transcode-session.js";
import { buildIntelQsvInputArgs, buildVideoEncoderArgs, buildVideoFilter as buildQsvAwareVideoFilter, planIntelQsv, type IntelQsvPlan } from "./intel-qsv.js";

const vodParamsSchema = z.object({ streamId: z.string().min(1), quality: z.string() });
const vodSegmentParamsSchema = vodParamsSchema.extend({ segment: z.string().regex(/^segment_\d{5}\.ts$/) });

type VodProgress = { frame?: number; fps?: number; bitrate?: string; outTime?: string; speed?: string; progress?: string };
type VodStatus = "starting" | "running" | "exited" | "failed";
type VodBatchSnapshot = { firstSegmentIndex: number; lastSegmentIndex: number; segmentCount: number; firstSegmentName: string; lastSegmentName: string; startSeconds: number; durationSeconds: number; startedAt: string; finishedAt?: string; speed?: string; fps?: number; preset?: string; crf?: number; videoBitrateKbps?: number; audioMode?: string; qsv?: { requestedMode: string; runtimeMode: string; active: boolean; fallbackToCpu: boolean; reason?: string; fallbackReason?: string } };
type VodSession = { id: string; streamId: string; title?: string; sourceAddon?: string; sourceQuality?: string; quality: TranscodeQuality; bufferPreset: BufferPreset; originalUrl: string; durationSeconds: number; segmentSeconds: number; targetBufferSeconds: number; strategy: VodTranscodeStrategy; outputDir: string; playlistPath: string; createdAt: string; updatedAt: string; status: VodStatus; error?: string; lastLog?: string; activeSegment?: string; activeBatch?: VodBatchSnapshot; lastBatch?: VodBatchSnapshot; progress?: VodProgress; speedStats?: TranscodeSpeedStats; activeProcess?: ChildProcess; qsv?: VodBatchSnapshot["qsv"] };

const vodSessions = new Map<string, VodSession>();
const activeSegments = new Map<string, Promise<void>>();
const sessionQueues = new Map<string, Promise<void>>();

export function listVodTranscodeSessions(): Array<any> {
  return Array.from(vodSessions.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map((session) => {
    const profile = getVodRuntimeProfile(session);
    const settings = getEffectiveTranscodeSettings();
    const generatedSegments = getGeneratedSegmentIndexes(session);
    const segmentCount = generatedSegments.length;
    const totalSegments = getSegmentCount(session);
    const queued = Array.from(activeSegments.keys()).filter((key) => key.startsWith(`${session.id}:`)).length;
    const { activeProcess: _activeProcess, ...snapshot } = session;
    return {
      ...snapshot,
      mode: "vod",
      modeLabel: session.strategy === "worker_v2" ? "VOD HLS worker v2" : session.strategy === "worker" ? "VOD HLS worker" : "VOD HLS batch",
      startedAt: session.createdAt,
      queuedSegments: queued,
      buffer: {
        segmentCount,
        generatedSegments: segmentCount,
        totalSegments,
        remainingSegments: Math.max(0, totalSegments - segmentCount),
        estimatedSeconds: segmentCount * session.segmentSeconds,
        estimatedGeneratedSeconds: segmentCount * session.segmentSeconds,
        segmentSeconds: session.segmentSeconds,
        targetSeconds: session.targetBufferSeconds,
        strategy: session.strategy,
        progression: settings.vodBufferProgression,
        adaptiveBatchEnabled: settings.vodAdaptiveBatchEnabled,
        fixedBatchSegmentCount: settings.vodFixedBatchSegmentCount,
        qualityMode: settings.vodQualityMode,
        bitrateMode: settings.vodBitrateMode,
        audioMode: settings.vodAudioMode,
        batchSegmentCount: getVodBatchSegmentCount(session),
        prewarmSegmentCount: getVodPrewarmSegmentCount(session),
        generatedRanges: getGeneratedSegmentRanges(generatedSegments).slice(0, 12),
        activeBatch: session.activeBatch,
        lastBatch: session.lastBatch
      },
      profile
    };
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
      ensureVodBufferAhead(session, 0);
      reply.header("content-type", "application/vnd.apple.mpegurl");
      reply.header("cache-control", "no-store");
      if (session.strategy === "worker_v2") return buildVodPlaylist(session);
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
      ensureVodBufferAhead(session, segmentIndex);
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
  const settings = getEffectiveTranscodeSettings();
  const strategy = settings.vodTranscodeStrategy;
  const sessionId = Buffer.from(`${streamId}|${quality}|${bufferPreset}|vod|${strategy}|${settings.vodSegmentSeconds}|${settings.vodStartupBufferSeconds}|${settings.vodBufferProgression}|${settings.vodAdaptiveBatchEnabled}|${settings.vodFixedBatchSegmentCount}|${settings.vodQualityMode}|${settings.vodBitrateMode}|${settings.vodAudioMode}|${settings.vodIntelQsvMode}`).toString("base64url");
  const existing = vodSessions.get(sessionId);
  if (existing) return existing;
  const durationSeconds = await probeDurationSeconds(original.originalUrl ?? "");
  const outputDir = join(getTranscodeCacheDir(), "vod", sessionId);
  mkdirSync(outputDir, { recursive: true });
  const now = new Date().toISOString();
  const qsvPlan = planIntelQsv(settings.vodIntelQsvMode);
  const session: VodSession = { id: sessionId, streamId, title: original.title || original.name, sourceAddon: original.sourceAddon, sourceQuality: original.quality, quality, bufferPreset, originalUrl: original.originalUrl ?? "", durationSeconds, segmentSeconds: profile.hlsSegmentSeconds, targetBufferSeconds: settings.vodStartupBufferSeconds, strategy, outputDir, playlistPath: join(outputDir, "master.m3u8"), createdAt: now, updatedAt: now, status: "starting", speedStats: { samples: 0 }, qsv: qsvSnapshot(qsvPlan) };
  await writeVodPlaylist(session);
  session.status = "exited";
  session.updatedAt = new Date().toISOString();
  vodSessions.set(sessionId, session);
  writeSystemLog(qsvPlan.enabled ? "info" : qsvPlan.requestedMode === "disabled" ? "debug" : "warn", "transcode-vod", qsvPlan.enabled ? "VOD HLS will use Intel hardware encoding." : "VOD HLS will use CPU libx264.", { streamId, quality, requestedMode: qsvPlan.requestedMode, runtimeMode: qsvPlan.runtimeMode, reason: qsvPlan.reason, qsvStatus: qsvPlan.status });
  writeSystemLog("info", "transcode-vod", "VOD playlist prepared.", { streamId, quality, durationSeconds, segmentSeconds: session.segmentSeconds, targetBufferSeconds: session.targetBufferSeconds, strategy, progression: settings.vodBufferProgression, adaptiveBatchEnabled: settings.vodAdaptiveBatchEnabled });
  return session;
}

function qsvSnapshot(plan: IntelQsvPlan): NonNullable<VodSession["qsv"]> {
  return { requestedMode: plan.requestedMode, runtimeMode: plan.runtimeMode, active: plan.enabled, fallbackToCpu: plan.fallbackToCpu, reason: plan.reason };
}

async function writeVodPlaylist(session: VodSession): Promise<void> {
  await writeFile(session.playlistPath, buildVodPlaylist(session), "utf-8");
}

function buildVodPlaylist(session: VodSession): string {
  if (session.strategy === "worker_v2") return buildVodEventPlaylist(session);
  return buildVodFullPlaylist(session);
}

function buildVodFullPlaylist(session: VodSession): string {
  const segmentCount = Math.max(1, Math.ceil(session.durationSeconds / session.segmentSeconds));
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${Math.ceil(session.segmentSeconds)}`, "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-INDEPENDENT-SEGMENTS", "#EXT-X-MEDIA-SEQUENCE:0"];
  for (let index = 0; index < segmentCount; index += 1) {
    const remaining = Math.max(0.1, session.durationSeconds - index * session.segmentSeconds);
    const duration = Math.min(session.segmentSeconds, remaining);
    lines.push(`#EXTINF:${duration.toFixed(3)},`, `segment_${String(index).padStart(5, "0")}.ts`);
  }
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

function buildVodEventPlaylist(session: VodSession): string {
  const ranges = getGeneratedSegmentRanges(getGeneratedSegmentIndexes(session));
  const activeStart = session.activeBatch?.firstSegmentIndex;
  const range = ranges.find((item) => activeStart !== undefined && activeStart >= item.start && activeStart <= item.end) ?? ranges[0];
  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, getStartupSegmentCount(session) - 1);
  const totalSegments = getSegmentCount(session);
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${Math.ceil(session.segmentSeconds)}`, "#EXT-X-PLAYLIST-TYPE:EVENT", "#EXT-X-INDEPENDENT-SEGMENTS", `#EXT-X-MEDIA-SEQUENCE:${start}`];
  for (let index = start; index <= end; index += 1) {
    const segmentName = `segment_${String(index).padStart(5, "0")}.ts`;
    if (!existsSync(join(session.outputDir, segmentName))) continue;
    const remaining = Math.max(0.1, session.durationSeconds - index * session.segmentSeconds);
    const duration = Math.min(session.segmentSeconds, remaining);
    lines.push(`#EXTINF:${duration.toFixed(3)},`, segmentName);
  }
  if (end >= totalSegments - 1) lines.push("#EXT-X-ENDLIST");
  lines.push("");
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
  await writeVodPlaylist(session);
  writeSystemLog("info", "transcode-vod", "VOD startup buffer is ready.", { streamId: session.streamId, quality: session.quality, requiredSegments, targetBufferSeconds: session.targetBufferSeconds, strategy: session.strategy });
}

function getStartupSegmentCount(session: VodSession): number {
  return Math.min(getSegmentCount(session), Math.max(1, Math.ceil(session.targetBufferSeconds / session.segmentSeconds)));
}

async function generateVodSegment(session: VodSession, segmentName: string): Promise<void> {
  const segmentIndex = parseSegmentIndex(segmentName);
  if (session.strategy === "batch") return generateVodSegmentBatch(session, segmentIndex, getVodBatchSegmentCount(session));
  prewarmVodSegments(session, segmentIndex, getWorkerSegmentCount(session, segmentIndex));
  await waitForSegmentFile(session, segmentName, 30_000);
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

function ensureVodBufferAhead(session: VodSession, currentIndex: number): void {
  const totalSegments = getSegmentCount(session);
  if (session.strategy !== "batch") {
    const firstMissingIndex = findFirstMissingSegmentIndex(session, currentIndex + 1, totalSegments - 1);
    if (firstMissingIndex !== undefined) prewarmVodSegments(session, firstMissingIndex, getWorkerSegmentCount(session, firstMissingIndex));
    return;
  }
  const settings = getEffectiveTranscodeSettings();
  const desiredEndIndex = settings.vodBufferProgression === "infinite" ? totalSegments - 1 : Math.min(totalSegments - 1, currentIndex + getVodPrewarmSegmentCount(session));
  const firstMissingIndex = findFirstMissingSegmentIndex(session, currentIndex + 1, desiredEndIndex);
  if (firstMissingIndex === undefined) return;
  const count = settings.vodBufferProgression === "infinite" ? getVodBatchSegmentCount(session) : desiredEndIndex - firstMissingIndex + 1;
  prewarmVodSegments(session, firstMissingIndex, count);
}

function prewarmVodSegments(session: VodSession, startIndex: number, count: number): void {
  if (startIndex < 0 || startIndex >= getSegmentCount(session)) return;
  if (session.strategy !== "batch" && session.activeProcess && session.activeBatch && (startIndex < session.activeBatch.firstSegmentIndex || startIndex > session.activeBatch.lastSegmentIndex)) {
    session.stopReason = "worker seek requested" as never;
    session.activeProcess.kill("SIGTERM");
  }
  generateVodSegmentBatch(session, startIndex, count).then(() => {
    void writeVodPlaylist(session).catch(() => undefined);
    if (session.strategy === "batch" && getEffectiveTranscodeSettings().vodBufferProgression === "infinite") ensureVodBufferAhead(session, startIndex + count - 1);
  }).catch((error) => {
    const message = error instanceof Error ? error.message : "VOD prewarm failed.";
    session.error = message;
    session.status = "failed";
    session.updatedAt = new Date().toISOString();
    writeSystemLog("warn", "transcode-vod", "VOD segment prewarm failed.", { streamId: session.streamId, quality: session.quality, startIndex, count, strategy: session.strategy, error: message });
  });
}

async function runVodSegmentBatchFfmpeg(session: VodSession, startSegmentIndex: number, segmentCount: number): Promise<void> {
  const qsvPlan = planIntelQsv(getEffectiveTranscodeSettings().vodIntelQsvMode);
  try {
    await runVodSegmentBatchFfmpegAttempt(session, startSegmentIndex, segmentCount, qsvPlan);
  } catch (error) {
    if (!qsvPlan.enabled) throw error;
    const message = error instanceof Error ? error.message : String(error);
    session.qsv = { ...(session.qsv ?? qsvSnapshot(qsvPlan)), active: false, runtimeMode: "cpu", fallbackToCpu: true, fallbackReason: message };
    writeSystemLog("warn", "transcode-vod", "Intel hardware encoding failed for VOD HLS; retrying batch with CPU libx264.", { streamId: session.streamId, quality: session.quality, startSegmentIndex, segmentCount, error: message });
    await runVodSegmentBatchFfmpegAttempt(session, startSegmentIndex, segmentCount, undefined);
  }
}

async function runVodSegmentBatchFfmpegAttempt(session: VodSession, startSegmentIndex: number, segmentCount: number, qsvPlan?: IntelQsvPlan): Promise<void> {
  const totalSegments = getSegmentCount(session);
  const safeStartIndex = Math.max(0, Math.min(startSegmentIndex, totalSegments - 1));
  const safeSegmentCount = Math.max(1, Math.min(segmentCount, totalSegments - safeStartIndex));
  const startSeconds = safeStartIndex * session.segmentSeconds;
  const durationSeconds = Math.min(session.segmentSeconds * safeSegmentCount, Math.max(0.1, session.durationSeconds - startSeconds));
  const firstSegmentName = `segment_${String(safeStartIndex).padStart(5, "0")}.ts`;
  const lastSegmentName = `segment_${String(safeStartIndex + safeSegmentCount - 1).padStart(5, "0")}.ts`;
  const tempPlaylistPath = join(session.outputDir, `batch_${String(safeStartIndex).padStart(5, "0")}_${Date.now()}.m3u8`);
  const startedAt = new Date().toISOString();
  const profile = getVodRuntimeProfile(session);
  const runtimePlan = qsvPlan?.enabled ? qsvPlan : undefined;
  const args = ["-hide_banner", "-loglevel", "warning", "-progress", "pipe:2", "-fflags", "+genpts", "-ss", String(startSeconds), "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5", ...buildIntelQsvInputArgs(runtimePlan ?? planIntelQsv("disabled")), "-i", session.originalUrl, "-t", String(durationSeconds), "-map", "0:v:0", "-map", "0:a:0?", "-max_muxing_queue_size", "2048", "-avoid_negative_ts", "make_zero", "-muxdelay", "0", "-muxpreload", "0"];
  if (session.strategy === "batch") args.push("-output_ts_offset", startSeconds.toFixed(3));
  args.push("-vf", buildQsvAwareVideoFilter(profile, runtimePlan?.runtimeMode ?? "cpu"), ...buildVideoEncoderArgs(profile, runtimePlan ?? planIntelQsv("disabled"), session.segmentSeconds), "-force_key_frames", `expr:gte(t,n_forced*${session.segmentSeconds})`);
  pushVodAudioArgs(args, profile.audioBitrateKbps);
  args.push("-f", "hls", "-hls_time", String(session.segmentSeconds), "-hls_list_size", "0", "-hls_flags", "independent_segments+temp_file", "-hls_segment_type", "mpegts", "-start_number", String(safeStartIndex), "-hls_segment_filename", join(session.outputDir, "segment_%05d.ts"), "-y", tempPlaylistPath);

  session.status = "running";
  session.qsv = runtimePlan ? qsvSnapshot(runtimePlan) : { requestedMode: qsvPlan?.requestedMode ?? "disabled", runtimeMode: "cpu", active: false, fallbackToCpu: true, reason: qsvPlan?.reason ?? "Intel QSV disabled or fallback CPU." };
  session.activeSegment = safeSegmentCount === 1 ? firstSegmentName : `${firstSegmentName}..${lastSegmentName}`;
  session.activeBatch = { firstSegmentIndex: safeStartIndex, lastSegmentIndex: safeStartIndex + safeSegmentCount - 1, segmentCount: safeSegmentCount, firstSegmentName, lastSegmentName, startSeconds, durationSeconds, startedAt, preset: profile.preset, crf: profile.crf, videoBitrateKbps: profile.videoBitrateKbps, audioMode: getEffectiveTranscodeSettings().vodAudioMode, qsv: session.qsv };
  session.updatedAt = new Date().toISOString();
  try {
    await runProcess(env.FFMPEG_PATH, args, session);
    if (!existsSync(join(session.outputDir, firstSegmentName))) throw new Error(`FFmpeg did not generate expected VOD segment ${firstSegmentName}.`);
  } finally {
    await rm(tempPlaylistPath, { force: true }).catch(() => undefined);
  }
  const finishedAt = new Date().toISOString();
  session.lastBatch = { ...session.activeBatch, finishedAt, speed: session.progress?.speed, fps: session.progress?.fps };
  session.status = "exited";
  session.activeSegment = undefined;
  session.activeBatch = undefined;
  session.updatedAt = finishedAt;
  await writeVodPlaylist(session).catch(() => undefined);
  writeSystemLog("info", "transcode-vod", "VOD segment batch generated.", { streamId: session.streamId, quality: session.quality, firstSegmentName, lastSegmentName, startSeconds, durationSeconds, segmentCount: safeSegmentCount, strategy: session.strategy, preset: profile.preset, crf: profile.crf, videoBitrateKbps: profile.videoBitrateKbps, speed: session.progress?.speed, fps: session.progress?.fps, qsv: session.qsv });
}

function getVodRuntimeProfile(session: VodSession): TranscodeProfile {
  const settings = getEffectiveTranscodeSettings();
  const profile = { ...getTranscodeProfile(session.quality, session.bufferPreset) };
  const speed = session.speedStats?.average;
  if (settings.vodQualityMode === "enabled" || session.strategy !== "batch") {
    profile.preset = "ultrafast";
    profile.crf = settings.vodCrf;
    if (settings.vodBitrateMode === "auto" && profile.videoBitrateKbps) profile.videoBitrateKbps = Math.max(250, Math.round(profile.videoBitrateKbps * 0.6));
  }
  if (settings.vodQualityMode === "auto" && session.strategy === "batch") applyVodAutoQualityLadder(profile, speed);
  return profile;
}

function pushVodAudioArgs(args: string[], audioBitrateKbps: number): void {
  const audioMode = getEffectiveTranscodeSettings().vodAudioMode;
  if (audioMode === "disabled") {
    args.push("-an");
    return;
  }
  if (audioMode === "copy") {
    args.push("-c:a", "copy");
    return;
  }
  args.push("-c:a", "aac", "-b:a", `${audioBitrateKbps}k`, "-ac", "2");
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
  if (session.strategy === "worker_v2") void writeVodPlaylist(session).catch(() => undefined);
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
  if (session.strategy !== "batch") return getWorkerSegmentCount(session, 0);
  const settings = getEffectiveTranscodeSettings();
  if (!settings.vodAdaptiveBatchEnabled) return Math.min(getSegmentCount(session), Math.max(1, settings.vodFixedBatchSegmentCount));
  const generatedSeconds = countGeneratedSegments(session) * session.segmentSeconds;
  const step = Math.max(1, Math.floor(generatedSeconds / 120));
  return Math.min(getSegmentCount(session), Math.max(2, step * 4));
}

function getWorkerSegmentCount(session: VodSession, startIndex: number): number {
  return Math.max(1, getSegmentCount(session) - Math.max(0, startIndex));
}

function getVodPrewarmSegmentCount(session: VodSession): number {
  const settings = getEffectiveTranscodeSettings();
  if (settings.vodBufferProgression === "infinite") return getSegmentCount(session);
  return Math.min(getSegmentCount(session), Math.max(1, Math.ceil(session.targetBufferSeconds / session.segmentSeconds)));
}

function findFirstMissingSegmentIndex(session: VodSession, startIndex: number, endIndex: number): number | undefined {
  for (let index = Math.max(0, startIndex); index <= endIndex; index += 1) {
    const segmentName = `segment_${String(index).padStart(5, "0")}.ts`;
    if (!existsSync(join(session.outputDir, segmentName))) return index;
  }
  return undefined;
}

function getGeneratedSegmentIndexes(session: VodSession): number[] {
  try {
    return readdirSync(session.outputDir)
      .map((file) => file.match(/^segment_(\d{5})\.ts$/)?.[1])
      .filter((value): value is string => Boolean(value))
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function getGeneratedSegmentRanges(indexes: number[]): Array<{ start: number; end: number; count: number }> {
  const ranges: Array<{ start: number; end: number; count: number }> = [];
  for (const index of indexes) {
    const last = ranges.at(-1);
    if (last && index === last.end + 1) {
      last.end = index;
      last.count += 1;
    } else {
      ranges.push({ start: index, end: index, count: 1 });
    }
  }
  return ranges;
}

function countGeneratedSegments(session: VodSession): number { return getGeneratedSegmentIndexes(session).length; }
function getSegmentCount(session: VodSession): number { return Math.max(1, Math.ceil(session.durationSeconds / session.segmentSeconds)); }
function parseSegmentIndex(segmentName: string): number { return Number.parseInt(segmentName.match(/\d{5}/)?.[0] ?? "0", 10); }
function buildVideoFilter(width?: number, height?: number): string { const filters: string[] = []; if (width && height) filters.push(`scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`); filters.push("format=yuv420p"); return filters.join(","); }
function resolveBufferPreset(value?: string): BufferPreset { if (value && isBufferPreset(value)) return value; return getEffectiveTranscodeBufferPreset() as BufferPreset; }

async function waitForSegmentFile(session: VodSession, segmentName: string, timeoutMs: number): Promise<void> {
  const path = join(session.outputDir, segmentName);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for VOD worker segment ${segmentName}.`);
}

async function probeDurationSeconds(url: string): Promise<number> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile(env.FFMPEG_PATH.replace(/ffmpeg$/, "ffprobe"), ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", url], { timeout: 20_000, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
  const value = Number.parseFloat(output.trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error("Could not determine VOD duration.");
  return value;
}

async function runProcess(command: string, args: string[], session: VodSession): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LIBVA_DRIVER_NAME: process.env.LIBVA_DRIVER_NAME ?? "i965" } });
    session.activeProcess = child;
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); parseVodProgress(session, stderr); });
    child.on("error", reject);
    child.on("close", (code) => {
      session.activeProcess = undefined;
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-4000) || `FFmpeg exited with code ${code}`));
    });
  });
}
