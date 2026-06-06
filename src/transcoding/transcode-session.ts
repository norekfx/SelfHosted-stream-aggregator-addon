import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { env, getTranscodeCacheDir } from "../config/env.js";
import { getEffectiveMaxTranscodeSessions } from "../settings/app-settings.js";
import type { BufferPreset, TranscodeQuality } from "../stremio/manifest.js";
import type { AggregatedStream } from "../streams/types.js";
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
  process?: ChildProcessWithoutNullStreams;
};

const sessions = new Map<string, TranscodeSession>();

export function getTranscodeSession(sessionId: string): TranscodeSession | undefined {
  return sessions.get(sessionId);
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
    if (/error|invalid|failed/i.test(text)) {
      session.error = text.slice(-1000);
      session.updatedAt = new Date().toISOString();
    }
  });

  child.on("error", (error) => {
    session.status = "failed";
    session.error = error.message;
    session.updatedAt = new Date().toISOString();
  });

  child.on("exit", (code) => {
    session.status = code === 0 ? "exited" : "failed";
    session.error = code === 0 ? session.error : session.error ?? `FFmpeg exited with code ${code}.`;
    session.updatedAt = new Date().toISOString();
  });
}

function buildFfmpegArgs(session: TranscodeSession): string[] {
  const profile = session.profile;
  const args = [
    "-hide_banner",
    "-loglevel",
    "warning",
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
    "-hls_segment_filename",
    join(session.outputDir, "segment_%05d.ts")
  ];

  if (session.quality === "auto") {
    args.push("-c:v", "copy");
  } else {
    args.push(
      "-vf",
      `scale=w=${profile.width}:h=${profile.height}:force_original_aspect_ratio=decrease`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-maxrate",
      `${profile.videoBitrateKbps}k`,
      "-bufsize",
      `${Math.round((profile.videoBitrateKbps ?? 1000) * 2)}k`
    );
  }

  args.push(session.playlistPath);
  return args;
}

function enforceSessionLimit(): void {
  const runningSessions = Array.from(sessions.values()).filter((session) => session.status === "running" || session.status === "starting");
  if (runningSessions.length < getEffectiveMaxTranscodeSessions()) {
    return;
  }

  const oldest = runningSessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
  if (oldest?.process) {
    oldest.process.kill("SIGTERM");
    oldest.status = "exited";
    oldest.updatedAt = new Date().toISOString();
  }
}

export function createTranscodeSessionId(streamId: string, quality: TranscodeQuality, bufferPreset: BufferPreset): string {
  return createSessionId(streamId, quality, bufferPreset);
}

function createSessionId(streamId: string, quality: TranscodeQuality, bufferPreset: BufferPreset): string {
  return Buffer.from(`${streamId}|${quality}|${bufferPreset}`).toString("base64url");
}
