import { spawnSync } from "node:child_process";
import { env } from "../config/env.js";
import type { TranscodeProfile } from "./transcode-profiles.js";

export type IntelQsvMode = "disabled" | "encode" | "decode_encode";
export type IntelQsvRuntimeMode = "cpu" | "qsv_encode" | "qsv_decode_encode";

export type IntelQsvStatus = {
  checkedAt: string;
  enabled: boolean;
  encoderAvailable: boolean;
  decoderAvailable: boolean;
  smokeTestOk: boolean;
  canEncode: boolean;
  canDecodeAndEncode: boolean;
  ffmpegPath: string;
  reason?: string;
  details?: string;
};

export type IntelQsvPlan = {
  requestedMode: IntelQsvMode;
  runtimeMode: IntelQsvRuntimeMode;
  enabled: boolean;
  fallbackToCpu: boolean;
  reason?: string;
  status: IntelQsvStatus;
};

let cachedStatus: IntelQsvStatus | undefined;
let cachedAt = 0;
const CACHE_TTL_MS = 30_000;

export function getIntelQsvStatus(force = false): IntelQsvStatus {
  const now = Date.now();
  if (!force && cachedStatus && now - cachedAt < CACHE_TTL_MS) return cachedStatus;

  const encoderList = runFfmpeg(["-hide_banner", "-encoders"]);
  const decoderList = runFfmpeg(["-hide_banner", "-decoders"]);
  const encoderAvailable = /\bh264_qsv\b/.test(encoderList.output);
  const decoderAvailable = /\bh264_qsv\b/.test(decoderList.output);
  let smokeTestOk = false;
  let reason: string | undefined;
  let details = [encoderList.error, decoderList.error].filter(Boolean).join("\n") || undefined;

  if (!encoderAvailable) {
    reason = "FFmpeg nie udostępnia enkodera h264_qsv. Zostanie użyty CPU libx264.";
  } else {
    const smoke = runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=128x72:rate=1",
      "-frames:v",
      "1",
      "-vf",
      "format=nv12",
      "-c:v",
      "h264_qsv",
      "-f",
      "null",
      "-"
    ], 6_000);
    smokeTestOk = smoke.status === 0;
    if (!smokeTestOk) {
      reason = "FFmpeg ma h264_qsv, ale test kodowania QSV nie przeszedł. Sprawdź /dev/dri, sterowniki Intel i build FFmpeg.";
      details = [details, smoke.error || smoke.output].filter(Boolean).join("\n");
    }
  }

  cachedStatus = {
    checkedAt: new Date().toISOString(),
    enabled: encoderAvailable && smokeTestOk,
    encoderAvailable,
    decoderAvailable,
    smokeTestOk,
    canEncode: encoderAvailable && smokeTestOk,
    canDecodeAndEncode: encoderAvailable && decoderAvailable && smokeTestOk,
    ffmpegPath: env.FFMPEG_PATH,
    reason,
    details: details?.slice(-4000)
  };
  cachedAt = now;
  return cachedStatus;
}

export function planIntelQsv(mode: IntelQsvMode): IntelQsvPlan {
  const status = getIntelQsvStatus();
  if (mode === "disabled") return { requestedMode: mode, runtimeMode: "cpu", enabled: false, fallbackToCpu: true, reason: "Intel QSV wyłączony w ustawieniach.", status };
  if (mode === "decode_encode" && status.canDecodeAndEncode) return { requestedMode: mode, runtimeMode: "qsv_decode_encode", enabled: true, fallbackToCpu: false, status };
  if (mode === "decode_encode" && status.canEncode) return { requestedMode: mode, runtimeMode: "qsv_encode", enabled: true, fallbackToCpu: true, reason: "QSV dekodowanie wejścia niedostępne lub niepewne; używam QSV tylko dla wyjścia.", status };
  if (mode === "encode" && status.canEncode) return { requestedMode: mode, runtimeMode: "qsv_encode", enabled: true, fallbackToCpu: false, status };
  return { requestedMode: mode, runtimeMode: "cpu", enabled: false, fallbackToCpu: true, reason: status.reason ?? "Intel QSV niedostępny; używam CPU libx264.", status };
}

export function buildIntelQsvInputArgs(plan: IntelQsvPlan): string[] {
  if (plan.runtimeMode !== "qsv_decode_encode") return [];
  return ["-hwaccel", "qsv", "-c:v", "h264_qsv"];
}

export function buildVideoFilter(profile: TranscodeProfile, runtimeMode: IntelQsvRuntimeMode): string {
  const filters: string[] = [];
  if (profile.width && profile.height) filters.push(`scale=w=${profile.width}:h=${profile.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`);
  filters.push(runtimeMode === "cpu" ? "format=yuv420p" : "format=nv12");
  return filters.join(",");
}

export function buildVideoEncoderArgs(profile: TranscodeProfile, plan: IntelQsvPlan, segmentSeconds: number): string[] {
  if (plan.runtimeMode === "cpu") {
    const args = ["-c:v", "libx264", "-preset", profile.preset, "-crf", String(profile.crf), "-pix_fmt", "yuv420p", "-profile:v", "high", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0"];
    if (profile.videoBitrateKbps) args.push("-maxrate", `${profile.videoBitrateKbps}k`, "-bufsize", `${Math.round(profile.videoBitrateKbps * 2)}k`);
    return args;
  }

  const gop = Math.max(24, Math.round(segmentSeconds * 12));
  const args = ["-c:v", "h264_qsv", "-preset", mapQsvPreset(profile.preset), "-profile:v", "high", "-g", String(gop), "-look_ahead", "0"];
  if (profile.videoBitrateKbps) {
    args.push("-b:v", `${profile.videoBitrateKbps}k`, "-maxrate", `${profile.videoBitrateKbps}k`, "-bufsize", `${Math.round(profile.videoBitrateKbps * 2)}k`);
  } else {
    args.push("-global_quality", String(Math.max(18, Math.min(35, profile.crf))));
  }
  return args;
}

function mapQsvPreset(preset: string): string {
  if (["ultrafast", "superfast"].includes(preset)) return "veryfast";
  if (["veryslow", "slower"].includes(preset)) return "slow";
  if (["faster", "fast", "medium", "slow"].includes(preset)) return preset;
  return "veryfast";
}

function runFfmpeg(args: string[], timeoutMs = 5_000): { status: number | null; output: string; error?: string } {
  const result = spawnSync(env.FFMPEG_PATH, args, { encoding: "utf-8", timeout: timeoutMs, maxBuffer: 1024 * 1024 });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    error: result.error?.message
  };
}
