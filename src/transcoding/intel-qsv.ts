import { spawnSync } from "node:child_process";
import { env } from "../config/env.js";
import type { TranscodeProfile } from "./transcode-profiles.js";

export type IntelQsvMode = "disabled" | "encode" | "decode_encode";
export type IntelQsvRuntimeMode = "cpu" | "qsv_encode" | "qsv_decode_encode" | "vaapi_encode";

export type IntelQsvStatus = {
  checkedAt: string;
  enabled: boolean;
  encoderAvailable: boolean;
  decoderAvailable: boolean;
  smokeTestOk: boolean;
  vaapiEncoderAvailable: boolean;
  vaapiSmokeTestOk: boolean;
  canEncode: boolean;
  canDecodeAndEncode: boolean;
  hardwareRuntimeMode: IntelQsvRuntimeMode;
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
const VAAPI_DEVICE = "/dev/dri/renderD128";

export function getIntelQsvStatus(force = false): IntelQsvStatus {
  const now = Date.now();
  if (!force && cachedStatus && now - cachedAt < CACHE_TTL_MS) return cachedStatus;

  const encoderList = runFfmpeg(["-hide_banner", "-encoders"]);
  const decoderList = runFfmpeg(["-hide_banner", "-decoders"]);
  const encoderAvailable = /\bh264_qsv\b/.test(encoderList.output);
  const decoderAvailable = /\bh264_qsv\b/.test(decoderList.output);
  const vaapiEncoderAvailable = /\bh264_vaapi\b/.test(encoderList.output);
  let smokeTestOk = false;
  let vaapiSmokeTestOk = false;
  let reason: string | undefined;
  let details = [encoderList.error, decoderList.error].filter(Boolean).join("\n") || undefined;

  if (encoderAvailable) {
    const smoke = runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=25",
      "-frames:v",
      "30",
      "-vf",
      "format=nv12",
      "-c:v",
      "h264_qsv",
      "-f",
      "null",
      "-"
    ], 10_000);
    smokeTestOk = smoke.status === 0;
    if (!smokeTestOk) details = [details, smoke.error || smoke.output].filter(Boolean).join("\n");
  }

  if (!smokeTestOk && vaapiEncoderAvailable) {
    const vaapiSmoke = runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-vaapi_device",
      VAAPI_DEVICE,
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=25",
      "-frames:v",
      "30",
      "-vf",
      "format=nv12,hwupload",
      "-c:v",
      "h264_vaapi",
      "-f",
      "null",
      "-"
    ], 10_000);
    vaapiSmokeTestOk = vaapiSmoke.status === 0;
    if (!vaapiSmokeTestOk) details = [details, vaapiSmoke.error || vaapiSmoke.output].filter(Boolean).join("\n");
  }

  const hardwareRuntimeMode: IntelQsvRuntimeMode = smokeTestOk ? "qsv_encode" : vaapiSmokeTestOk ? "vaapi_encode" : "cpu";
  const hardwareOk = smokeTestOk || vaapiSmokeTestOk;
  if (!encoderAvailable && !vaapiEncoderAvailable) {
    reason = "FFmpeg nie udostępnia h264_qsv ani h264_vaapi. Zostanie użyty CPU libx264.";
  } else if (!smokeTestOk && vaapiSmokeTestOk) {
    reason = "h264_qsv nie działa na tym hoście, ale Intel VAAPI h264_vaapi działa przez i965. Użyję sprzętowego kodowania VAAPI jako fallback dla Haswell.";
  } else if (!hardwareOk) {
    reason = "FFmpeg ma enkoder sprzętowy Intel, ale test kodowania nie przeszedł. Sprawdź /dev/dri, sterowniki Intel VAAPI i build FFmpeg.";
  }

  cachedStatus = {
    checkedAt: new Date().toISOString(),
    enabled: hardwareOk,
    encoderAvailable,
    decoderAvailable,
    smokeTestOk,
    vaapiEncoderAvailable,
    vaapiSmokeTestOk,
    canEncode: hardwareOk,
    canDecodeAndEncode: encoderAvailable && decoderAvailable && smokeTestOk,
    hardwareRuntimeMode,
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
  if (mode === "decode_encode" && status.canEncode) return { requestedMode: mode, runtimeMode: status.hardwareRuntimeMode, enabled: true, fallbackToCpu: true, reason: status.hardwareRuntimeMode === "vaapi_encode" ? "QSV nie działa; używam Intel VAAPI tylko dla wyjścia." : "QSV dekodowanie wejścia niedostępne lub niepewne; używam QSV tylko dla wyjścia.", status };
  if (mode === "encode" && status.canEncode) return { requestedMode: mode, runtimeMode: status.hardwareRuntimeMode, enabled: true, fallbackToCpu: status.hardwareRuntimeMode === "vaapi_encode", reason: status.hardwareRuntimeMode === "vaapi_encode" ? "QSV nie działa; używam Intel VAAPI h264_vaapi jako sprzętowy fallback." : undefined, status };
  return { requestedMode: mode, runtimeMode: "cpu", enabled: false, fallbackToCpu: true, reason: status.reason ?? "Intel QSV/VAAPI niedostępny; używam CPU libx264.", status };
}

export function buildIntelQsvInputArgs(plan: IntelQsvPlan): string[] {
  if (plan.runtimeMode === "qsv_decode_encode") return ["-hwaccel", "qsv", "-c:v", "h264_qsv"];
  if (plan.runtimeMode === "vaapi_encode") return ["-vaapi_device", VAAPI_DEVICE];
  return [];
}

export function buildVideoFilter(profile: TranscodeProfile, runtimeMode: IntelQsvRuntimeMode): string {
  const filters: string[] = [];
  if (profile.width && profile.height) filters.push(`scale=w=${profile.width}:h=${profile.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`);
  if (runtimeMode === "cpu") filters.push("format=yuv420p");
  else if (runtimeMode === "vaapi_encode") filters.push("format=nv12", "hwupload");
  else filters.push("format=nv12");
  return filters.join(",");
}

export function buildVideoEncoderArgs(profile: TranscodeProfile, plan: IntelQsvPlan, segmentSeconds: number): string[] {
  if (plan.runtimeMode === "cpu") {
    const args = ["-c:v", "libx264", "-preset", profile.preset, "-crf", String(profile.crf), "-pix_fmt", "yuv420p", "-profile:v", "high", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0"];
    if (profile.videoBitrateKbps) args.push("-maxrate", `${profile.videoBitrateKbps}k`, "-bufsize", `${Math.round(profile.videoBitrateKbps * 2)}k`);
    return args;
  }

  const gop = Math.max(24, Math.round(segmentSeconds * 12));
  if (plan.runtimeMode === "vaapi_encode") {
    const args = ["-c:v", "h264_vaapi", "-profile:v", "high", "-g", String(gop), "-bf", "0"];
    if (profile.videoBitrateKbps) args.push("-b:v", `${profile.videoBitrateKbps}k`, "-maxrate", `${profile.videoBitrateKbps}k`, "-bufsize", `${Math.round(profile.videoBitrateKbps * 2)}k`);
    else args.push("-qp", String(Math.max(18, Math.min(35, profile.crf))));
    return args;
  }

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
  const result = spawnSync(env.FFMPEG_PATH, args, { encoding: "utf-8", timeout: timeoutMs, maxBuffer: 1024 * 1024, env: { ...process.env, LIBVA_DRIVER_NAME: process.env.LIBVA_DRIVER_NAME ?? "i965" } });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    error: result.error?.message
  };
}
