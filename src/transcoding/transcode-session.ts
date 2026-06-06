import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { env, getTranscodeCacheDir } from "../config/env.js";
import { getEffectiveMaxTranscodeSessions } from "../settings/app-settings.js";
import type { BufferPreset, TranscodeQuality } from "../stremio/manifest.js";
import type { AggregatedStream } from "../streams/types.js";
import { writeSystemLog } from "../system/system-log.js";
import { getTranscodeProfile, type TranscodeProfile } from "./transcode-profiles.js";

export type TranscodeSessionStatus = "starting" | "running" | "exited" | "failed";

export type TranscodeSession = {
  id: string;
  streamId: string;
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
  progress?: {
    frame?: number;
    fps?: number;
    bitrate?: string;
    outTime?: string;
    speed?: string;
    progress?: string;
  };
  process?: ChildProcessWithoutNullStreams;
};

const sessions = new Map<string, TranscodeSession>();

export function getTranscodeSession(sessionId: string): TranscodeSession | undefined {
  return sessions.get(sessionId);
}

export function listTranscodeSessions(): Array<Omit<TranscodeSession, "process">> {
  return Array.from(sessions.values())
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 50)
    .map(({ process: _process, ...session }) => session);
}

export function getOrCreateTranscodeSession(
  original: AggregatedStream,
  quality: TranscodeQuality,
  bufferPreset: BufferPreset
): TranscodeSession {
  if (!original.originalUrl) {
    throw new Error("Selected original has no originalUrl.");
  }

  const sessionId = createSessionId(original.id, quality, bufferPreset);
  const existing = sessions.get(sessionId);
  if (existing && existing.status !== "failed" && existing.status !== "exited") {
    return existing;
  }

  enforceSessionLimit();

  const outputDir = join(getTranscodeCacheDir(), sessionId);
  mkdirSync(outputDir, { recursive: true });

  const profile = getTranscodeProfile(quality, bufferPreset);
  const session: TranscodeSession = {
    id: sessionId,
    streamId: original.id,
    quality,
    bufferPreset,
    originalUrl: original.originalUrl,
    profile,
    outputDir,
    playlistPath: join(outputDir, "master.m3u8"),
    status: "starting",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  sessions.set(sessionId, session);
  startFfmpeg(session);
  return session;
}

function startFfmpeg(session: TranscodeSession): void {
  const args = buildFfmpegArgs(session);
  const child = spawn(env.FFMPEG_PATH, args, { stdio: "pipe" });
  session.process = child;
  session.status = "running";
  session.updatedAt = new Date().toISOString();

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    session.lastLog = text.slice(-2000);
    parseFfmpegProgress(session, text);

    if (/error|invalid|failed/i.test(text)) {
      session.error = text.slice(-2000);
    }

    session.updatedAt = new Date().toISOString();
  });

  child.on("error", (error) => {
    session.status = "failed";
    session.error = error.message;
    session.updatedAt = new Date().toISOString();
    writeSystemLog("error", "transcode", error.message, {
      sessionId: session.id,
      streamId: session.streamId,
      quality: session.quality,
      bufferPreset: session.bufferPreset
    });
  });

  child.on("exit", (code, signal) => {
    session.process = undefined;
    session.updatedAt = new Date().toISOString();

    if (session.stopReason) {
      session.status = "exited";
      session.lastLog = session.stopReason;
      writeSystemLog("info", "transcode", "FFmpeg session stopped intentionally.", {
        sessionId: session.id,
        streamId: session.streamId,
        quality: session.quality,
        bufferPreset: session.bufferPreset,
        reason: session.stopReason,
        signal
      });
      return;
    }

    session.status = code === 0 ? "exited" : "failed";
    if (code !== 0) {
      session.error = session.error ?? `FFmpeg exited with code ${code}${signal ? `, signal ${signal}` : ""}.`;
      writeSystemLog("error", "transcode", session.error, {
        sessionId: session.id,
        streamId: session.streamId,
        quality: session.quality,
        bufferPreset: session.bufferPreset,
        signal
      });
    }
  });
}

function buildFfmpegArgs(session: TranscodeSession): string[] {
  const profile = session.profile;
  const args = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-nostats",
    "-progress",
    "pipe:2",
    "-fflags",
    "+genpts",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "5",
    "-i",
    session.originalUrl,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-max_muxing_queue_size",
    "2048"
  ];

  const videoFilters: string[] = [];
  if (profile.width && profile.height) {
    videoFilters.push(`scale=w=${profile.width}:h=${profile.height}:force_original_aspect_ratio=decrease`);
  }

  if (videoFilters.length > 0) {
    args.push("-vf", videoFilters.join(","));
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    session.quality === "auto" ? "22" : "23",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high"
  );

  if (profile.videoBitrateKbps) {
    args.push(
      "-maxrate",
      `${profile.videoBitrateKbps}k`,
      "-bufsize",
      `${Math.round(profile.videoBitrateKbps * 2)}k`
    );
  }

  args.push(
    "-c:a",
    "aac",
    "-b:a",
    `${profile.audioBitrateKbps}k`,
    "-ac",
    "2",
    "-f",
    "hls",
    "-hls_time",
    String(profile.hlsSegmentSeconds),
    "-hls_list_size",
    String(profile.hlsListSize),
    "-hls_flags",
    "delete_segments+append_list+independent_segments",
    "-hls_segment_type",
    "mpegts",
    "-hls_segment_filename",
    join(session.outputDir, "segment_%05d.ts"),
    session.playlistPath
  );

  return args;
}

function enforceSessionLimit(): void {
  const runningSessions = Array.from(sessions.values()).filter((session) => session.status === "running" || session.status === "starting");
  if (runningSessions.length < getEffectiveMaxTranscodeSessions()) {
    return;
  }

  const oldest = runningSessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
  if (oldest?.process) {
    oldest.stopReason = "session limit reached";
    oldest.process.kill("SIGTERM");
    oldest.status = "exited";
    oldest.updatedAt = new Date().toISOString();
    writeSystemLog("warn", "transcode", "Stopped oldest transcode session because the session limit was reached.", {
      sessionId: oldest.id,
      streamId: oldest.streamId,
      quality: oldest.quality
    });
  }
}

function parseFfmpegProgress(session: TranscodeSession, text: string): void {
  const progress = session.progress ?? {};
  for (const line of text.split(/\r?\n/)) {
    const [key, value] = line.split("=", 2);
    if (!key || value === undefined) continue;

    if (key === "frame") progress.frame = Number.parseInt(value, 10);
    if (key === "fps") progress.fps = Number.parseFloat(value);
    if (key === "bitrate") progress.bitrate = value;
    if (key === "out_time") progress.outTime = value;
    if (key === "speed") progress.speed = value;
    if (key === "progress") progress.progress = value;
  }
  session.progress = progress;
}

export function createTranscodeSessionId(streamId: string, quality: TranscodeQuality, bufferPreset: BufferPreset): string {
  return createSessionId(streamId, quality, bufferPreset);
}

function createSessionId(streamId: string, quality: TranscodeQuality, bufferPreset: BufferPreset): string {
  return Buffer.from(`${streamId}|${quality}|${bufferPreset}`).toString("base64url");
}
