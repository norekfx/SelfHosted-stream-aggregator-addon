import type { TranscodeProfile } from "./transcode-profiles.js";

export type VodAutoQualityOptions = {
  minSpeed?: number;
  targetSpeed?: number;
  keepPreset?: boolean;
};

const DEFAULT_MIN_SPEED = 1.10;
const DEFAULT_TARGET_SPEED = 1.15;

export function applyVodAutoQualityLadder(profile: TranscodeProfile, speed: number | undefined, options: VodAutoQualityOptions = {}): void {
  if (!Number.isFinite(speed)) return;

  const value = Number(speed);
  const minSpeed = options.minSpeed ?? DEFAULT_MIN_SPEED;
  const targetSpeed = options.targetSpeed ?? DEFAULT_TARGET_SPEED;
  const keepPreset = options.keepPreset === true;

  if (value >= 2) {
    if (!keepPreset) profile.preset = "faster";
    improveQuality(profile, 4, 1.30);
    return;
  }

  if (value >= 1.5) {
    if (!keepPreset) profile.preset = "veryfast";
    improveQuality(profile, 3, 1.20);
    return;
  }

  if (value >= 1.25) {
    if (!keepPreset) profile.preset = "veryfast";
    improveQuality(profile, 2, 1.12);
    return;
  }

  if (value >= targetSpeed) {
    improveQuality(profile, 1, 1.05);
    return;
  }

  if (value >= minSpeed) {
    if (!keepPreset) profile.preset = "veryfast";
    return;
  }

  if (value >= 1.0) {
    if (!keepPreset) profile.preset = "superfast";
    reduceQuality(profile, 2, 0.85);
    return;
  }

  if (value >= 0.9) {
    if (!keepPreset) profile.preset = "ultrafast";
    reduceQuality(profile, 4, 0.70);
    return;
  }

  if (value >= 0.75) {
    if (!keepPreset) profile.preset = "ultrafast";
    reduceQuality(profile, 6, 0.55);
    return;
  }

  if (value >= 0.6) {
    if (!keepPreset) profile.preset = "ultrafast";
    reduceQuality(profile, 8, 0.40);
    return;
  }

  if (!keepPreset) profile.preset = "ultrafast";
  profile.crf = 35;
  scaleBitrate(profile, 0.30);
}

function improveQuality(profile: TranscodeProfile, crfStep: number, bitrateMultiplier: number): void {
  profile.crf = clampInt(profile.crf - crfStep, 16, 35);
  scaleBitrate(profile, bitrateMultiplier);
}

function reduceQuality(profile: TranscodeProfile, crfStep: number, bitrateMultiplier: number): void {
  profile.crf = clampInt(profile.crf + crfStep, 16, 35);
  scaleBitrate(profile, bitrateMultiplier);
}

function scaleBitrate(profile: TranscodeProfile, multiplier: number): void {
  if (!profile.videoBitrateKbps) return;
  profile.videoBitrateKbps = clampInt(Math.round(profile.videoBitrateKbps * multiplier), 150, 18_000);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
