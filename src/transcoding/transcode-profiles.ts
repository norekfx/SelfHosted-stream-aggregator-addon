import type { BufferPreset, TranscodeQuality } from "../stremio/manifest.js";

export type TranscodeProfile = {
  quality: TranscodeQuality;
  label: string;
  width?: number;
  height?: number;
  videoBitrateKbps?: number;
  audioBitrateKbps: number;
  hlsSegmentSeconds: number;
  hlsListSize: number;
};

const baseProfiles: Record<TranscodeQuality, Omit<TranscodeProfile, "hlsSegmentSeconds" | "hlsListSize">> = {
  auto: { quality: "auto", label: "Auto", audioBitrateKbps: 160 },
  "4k": { quality: "4k", label: "4K", width: 3840, height: 2160, videoBitrateKbps: 18000, audioBitrateKbps: 192 },
  "1440p": { quality: "1440p", label: "1440p", width: 2560, height: 1440, videoBitrateKbps: 10000, audioBitrateKbps: 192 },
  "1080p": { quality: "1080p", label: "1080p", width: 1920, height: 1080, videoBitrateKbps: 6000, audioBitrateKbps: 160 },
  "720p": { quality: "720p", label: "720p", width: 1280, height: 720, videoBitrateKbps: 3500, audioBitrateKbps: 128 },
  "480p": { quality: "480p", label: "480p", width: 854, height: 480, videoBitrateKbps: 1800, audioBitrateKbps: 128 },
  "360p": { quality: "360p", label: "360p", width: 640, height: 360, videoBitrateKbps: 1000, audioBitrateKbps: 96 },
  "240p": { quality: "240p", label: "240p", width: 426, height: 240, videoBitrateKbps: 600, audioBitrateKbps: 96 },
  "144p": { quality: "144p", label: "144p", width: 256, height: 144, videoBitrateKbps: 250, audioBitrateKbps: 64 }
};

export function getTranscodeProfile(quality: TranscodeQuality, bufferPreset: BufferPreset): TranscodeProfile {
  const hls = getHlsBufferSettings(bufferPreset);
  return {
    ...baseProfiles[quality],
    hlsSegmentSeconds: hls.segmentSeconds,
    hlsListSize: hls.listSize
  };
}

export function getHlsBufferSettings(bufferPreset: BufferPreset): { segmentSeconds: number; listSize: number } {
  switch (bufferPreset) {
    case "disabled":
      return { segmentSeconds: 1, listSize: 2 };
    case "auto":
      return { segmentSeconds: 4, listSize: 6 };
    case "2s":
      return { segmentSeconds: 1, listSize: 2 };
    case "5s":
      return { segmentSeconds: 1, listSize: 5 };
    case "10s":
      return { segmentSeconds: 2, listSize: 5 };
    case "15s":
      return { segmentSeconds: 3, listSize: 5 };
    case "20s":
      return { segmentSeconds: 4, listSize: 5 };
    case "30s":
      return { segmentSeconds: 5, listSize: 6 };
    case "45s":
      return { segmentSeconds: 5, listSize: 9 };
    case "60s":
      return { segmentSeconds: 6, listSize: 10 };
  }
}

export function isTranscodeQuality(value: string): value is TranscodeQuality {
  return value === "auto" || value === "4k" || value === "1440p" || value === "1080p" || value === "720p" || value === "480p" || value === "360p" || value === "240p" || value === "144p";
}

export function isBufferPreset(value: string): value is BufferPreset {
  return value === "disabled" || value === "auto" || value === "2s" || value === "5s" || value === "10s" || value === "15s" || value === "20s" || value === "30s" || value === "45s" || value === "60s";
}
