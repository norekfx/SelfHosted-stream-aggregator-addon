import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { env, getTranscodeCacheDir } from "../config/env.js";
import { getEffectiveMaxTranscodeSessions, getEffectiveTranscodeSettings } from "../settings/app-settings.js";
import type { BufferPreset, TranscodeQuality } from "../stremio/manifest.js";
import type { AggregatedStream } from "../streams/types.js";
import { writeSystemLog } from "../system/system-log.js";
import { getTranscodeProfile, type TranscodeProfile } from "./transcode-profiles.js";
import { buildIntelQsvInputArgs, buildVideoEncoderArgs, buildVideoFilter, planIntelQsv, type IntelQsvPlan } from "./intel-qsv.js";

export type TranscodeSessionStatus = "starting" | "running" | "exited" | "failed";

export type TranscodeSpeedStats = {
  samples: number;
  average?: number;
  min?: number;
  max?: number;
};

export type TranscodeSession = {
  id: string;
  streamId: string;
  title?: string;
  sourceAddon?: string;
  sourceQuality?: string;
  quality: TranscodeQuality;
  bufferPreset: BufferPreset;
  originalUrl: string;
  profile: TranscodeProfile;
  outputDir: string;
  playlistPath: string;
  status: TranscodeSessionStatus;
  startedAt: string;
  updatedAt: string;
  error?: string;
  lastLog?: string;
  stopReason?: string;
  progress?: { frame?: number; fps?: number; bitrate?: string; outTime?: string; speed?: string; progress?: string };
  speedStats?: TranscodeSpeedStats;
  buffer?: { segmentCount: number; estimatedSeconds: number; segmentSeconds: number };
  process?: ChildProcessWithoutNullStreams;
  qsv?: { requestedMode: string; runtimeMode: string; active: boolean; fallbackToCpu: boolean; reason?: string; fallbackReason?: string };
};

const sessions = new Map<string, TranscodeSession>();

export function getTranscodeSession(sessionId: string): TranscodeSession | undefined { const session = sessions.get(sessionId); if (session) updateBufferInfo(session); return session; }
export function listTranscodeSessions(): Array<Omit<TranscodeSession, "process">> { return Array.from(sessions.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 50).map((session) => { updateBufferInfo(session); const { process: _process, ...snapshot } = session; return snapshot; }); }
export function stopTranscodeSession(sessionId: string, reason = "stopped manually"): Omit<TranscodeSession, "process"> | undefined { const session = sessions.get(sessionId); if (!session) return undefined; return stopSession(session, reason); }
export function stopActiveTranscodeSessions(reason = "another transcode mode requested"): number { const active = Array.from(sessions.values()).filter((session) => session.status === "running" || session.status === "starting"); for (const session of active) stopSession(session, reason); return active.length; }

export function getOrCreateTranscodeSession(original: AggregatedStream, quality: TranscodeQuality, bufferPreset: BufferPreset): TranscodeSession {
  if (!original.originalUrl) throw new Error("Selected original has no originalUrl.");
  const sessionId = createSessionId(original.id, quality, bufferPreset);
  const existing = sessions.get(sessionId);
  if (existing && existing.status !== "failed" && existing.status !== "exited") { updateBufferInfo(existing); return existing; }
  enforceSessionLimit();
  const outputDir = join(getTranscodeCacheDir(), sessionId);
  mkdirSync(outputDir, { recursive: true });
  const profile = getTranscodeProfile(quality, bufferPreset);
  const qsvPlan = planIntelQsv(getEffectiveTranscodeSettings().liveIntelQsvMode);
  const session: TranscodeSession = { id: sessionId, streamId: original.id, title: original.title || original.name, sourceAddon: original.sourceAddon, sourceQuality: original.quality, quality, bufferPreset, originalUrl: original.originalUrl, profile, outputDir, playlistPath: join(outputDir, "master.m3u8"), status: "starting", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), speedStats: { samples: 0 }, buffer: { segmentCount: 0, estimatedSeconds: 0, segmentSeconds: profile.hlsSegmentSeconds }, qsv: qsvSnapshot(qsvPlan) };
  sessions.set(sessionId, session);
  writeSystemLog(qsvPlan.enabled ? "info" : qsvPlan.requestedMode === "disabled" ? "debug" : "warn", "transcode", qsvPlan.enabled ? "Live HLS will use Intel QSV." : "Live HLS will use CPU libx264.", { sessionId, streamId: original.id, requestedMode: qsvPlan.requestedMode, runtimeMode: qsvPlan.runtimeMode, reason: qsvPlan.reason, qsvStatus: qsvPlan.status });
  startFfmpeg(session, qsvPlan);
  return session;
}

function qsvSnapshot(plan: IntelQsvPlan): NonNullable<TranscodeSession["qsv"]> {
  return { requestedMode: plan.requestedMode, runtimeMode: plan.runtimeMode, active: plan.enabled, fallbackToCpu: plan.fallbackToCpu, reason: plan.reason };
}

function stopSession(session: TranscodeSession, reason: string): Omit<TranscodeSession, "process"> {
  session.stopReason = reason;
  session.updatedAt = new Date().toISOString();
  if (session.process && (session.status === "running" || session.status === "starting")) {
    session.process.kill("SIGTERM");
  } else if (session.status === "running" || session.status === "starting") {
    session.status = "exited";
  }
  updateBufferInfo(session);
  const { process: _process, ...snapshot } = session;
  writeSystemLog("info", "transcode", "Transcode session stop requested.", { sessionId: session.id, streamId: session.streamId, quality: session.quality, reason });
  return snapshot;
}

function startFfmpeg(session: TranscodeSession, qsvPlan: IntelQsvPlan): void {
  startFfmpegAttempt(session, qsvPlan, false);
}

function startFfmpegAttempt(session: TranscodeSession, qsvPlan: IntelQsvPlan, forcedCpu: boolean): void {
  const child = spawn(env.FFMPEG_PATH, buildFfmpegArgs(session, forcedCpu ? undefined : qsvPlan), { stdio: "pipe" });
  session.process = child; session.status = "running"; session.updatedAt = new Date().toISOString();
  child.stderr.on("data", (chunk) => { const text = chunk.toString(); session.lastLog = text.slice(-2000); parseFfmpegProgress(session, text); updateBufferInfo(session); if (/error|invalid|failed/i.test(text)) session.error = text.slice(-2000); session.updatedAt = new Date().toISOString(); });
  child.on("error", (error) => { session.status = "failed"; session.error = error.message; session.updatedAt = new Date().toISOString(); writeSystemLog("error", "transcode", error.message, { sessionId: session.id, streamId: session.streamId, quality: session.quality, bufferPreset: session.bufferPreset, qsv: session.qsv }); });
  child.on("exit", (code, signal) => {
    session.process = undefined; updateBufferInfo(session); session.updatedAt = new Date().toISOString();
    if (session.stopReason) { session.status = "exited"; session.lastLog = session.stopReason; writeSystemLog("info", "transcode", "FFmpeg session stopped intentionally.", { sessionId: session.id, streamId: session.streamId, quality: session.quality, bufferPreset: session.bufferPreset, reason: session.stopReason, signal }); return; }
    if (code !== 0 && !forcedCpu && qsvPlan.enabled) {
      session.qsv = { ...(session.qsv ?? qsvSnapshot(qsvPlan)), active: false, runtimeMode: "cpu", fallbackToCpu: true, fallbackReason: `QSV FFmpeg exited with code ${code}${signal ? `, signal ${signal}` : ""}; retrying CPU libx264.` };
      session.error = undefined;
      writeSystemLog("warn", "transcode", "Intel QSV failed for Live HLS; retrying with CPU libx264.", { sessionId: session.id, streamId: session.streamId, quality: session.quality, qsv: session.qsv, lastLog: session.lastLog });
      startFfmpegAttempt(session, qsvPlan, true);
      return;
    }
    session.status = code === 0 ? "exited" : "failed";
    if (code !== 0) { session.error = session.error ?? `FFmpeg exited with code ${code}${signal ? `, signal ${signal}` : ""}.`; writeSystemLog("error", "transcode", session.error, { sessionId: session.id, streamId: session.streamId, quality: session.quality, bufferPreset: session.bufferPreset, signal, qsv: session.qsv }); }
  });
}

function buildFfmpegArgs(session: TranscodeSession, qsvPlan?: IntelQsvPlan): string[] {
  const profile = session.profile;
  const runtimePlan = qsvPlan?.enabled ? qsvPlan : undefined;
  const args = ["-hide_banner", "-loglevel", "warning", "-nostats", "-progress", "pipe:2", "-fflags", "+genpts", "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5", ...buildIntelQsvInputArgs(runtimePlan ?? planIntelQsv("disabled")), "-i", session.originalUrl, "-map", "0:v:0", "-map", "0:a:0?", "-max_muxing_queue_size", "2048"];
  args.push("-vf", buildVideoFilter(profile, runtimePlan?.runtimeMode ?? "cpu"));
  args.push(...buildVideoEncoderArgs(profile, runtimePlan ?? planIntelQsv("disabled"), profile.hlsSegmentSeconds));
  args.push("-c:a", "aac", "-b:a", `${profile.audioBitrateKbps}k`, "-ac", "2", "-f", "hls", "-hls_time", String(profile.hlsSegmentSeconds), "-hls_list_size", "0", "-hls_playlist_type", "event", "-hls_flags", "independent_segments+temp_file", "-hls_segment_type", "mpegts", "-hls_segment_filename", join(session.outputDir, "segment_%05d.ts"), session.playlistPath);
  return args;
}

function enforceSessionLimit(): void { const runningSessions = Array.from(sessions.values()).filter((session) => session.status === "running" || session.status === "starting"); if (runningSessions.length < getEffectiveMaxTranscodeSessions()) return; const oldest = runningSessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0]; if (oldest?.process) { oldest.stopReason = "session limit reached"; oldest.process.kill("SIGTERM"); oldest.status = "exited"; oldest.updatedAt = new Date().toISOString(); writeSystemLog("warn", "transcode", "Stopped oldest transcode session because the session limit was reached.", { sessionId: oldest.id, streamId: oldest.streamId, quality: oldest.quality }); } }
function parseFfmpegProgress(session: TranscodeSession, text: string): void { const progress = session.progress ?? {}; for (const line of text.split(/\r?\n/)) { const [key, value] = line.split("=", 2); if (!key || value === undefined) continue; if (key === "frame") progress.frame = Number.parseInt(value, 10); if (key === "fps") progress.fps = Number.parseFloat(value); if (key === "bitrate") progress.bitrate = value; if (key === "out_time") progress.outTime = value; if (key === "speed") { progress.speed = value; updateSpeedStats(session, value); } if (key === "progress") progress.progress = value; } session.progress = progress; }
function updateSpeedStats(session: TranscodeSession, rawSpeed: string): void { const speed = Number.parseFloat(rawSpeed.replace(/x$/i, "")); if (!Number.isFinite(speed) || speed <= 0) return; const stats = session.speedStats ?? { samples: 0 }; const samples = stats.samples + 1; const previousAverage = stats.average ?? speed; stats.samples = samples; stats.average = ((previousAverage * (samples - 1)) + speed) / samples; stats.min = stats.min === undefined ? speed : Math.min(stats.min, speed); stats.max = stats.max === undefined ? speed : Math.max(stats.max, speed); session.speedStats = stats; }
function updateBufferInfo(session: TranscodeSession): void { try { const segmentCount = readdirSync(session.outputDir).filter((file) => /^segment_\d{5}\.ts$/.test(file)).length; session.buffer = { segmentCount, estimatedSeconds: segmentCount * session.profile.hlsSegmentSeconds, segmentSeconds: session.profile.hlsSegmentSeconds }; } catch { session.buffer = { segmentCount: 0, estimatedSeconds: 0, segmentSeconds: session.profile.hlsSegmentSeconds }; } }
export function createTranscodeSessionId(streamId: string, quality: TranscodeQuality, bufferPreset: BufferPreset): string { return createSessionId(streamId, quality, bufferPreset); }
function createSessionId(streamId: string, quality: TranscodeQuality, bufferPreset: BufferPreset): string { return Buffer.from(`${streamId}|${quality}|${bufferPreset}`).toString("base64url"); }
