import type { TranscodeProfile } from "./transcode-profiles.js";

export function applyVodAutoQualityLadder(profile: TranscodeProfile, speed: number | undefined): void {
  if (!Number.isFinite(speed)) return;
  const value = Number(speed);

  if (value >= 2) {
    profile.preset = "faster";
    profile.crf = Math.min(profile.crf, 20);
    scaleBitrate(profile, 1.25);
    return;
  }

  if (value >= 1.5) {
    profile.preset = "veryfast";
    profile.crf = Math.min(profile.crf, 21);
    scaleBitrate(profile, 1.1);
    return;
  }

  if (value >= 1.1) {
    profile.preset = "veryfast";
    return;
  }

  if (value >= 1.05) return;

  if (value >= 1) {
    profile.preset = "superfast";
    profile.crf = Math.max(profile.crf, 28);
    scaleBitrate(profile, 0.75);
    return;
  }

  if (value >= 0.9) {
    profile.preset = "ultrafast";
    profile.crf = Math.max(profile.crf, 30);
    scaleBitrate(profile, 0.55);
    return;
  }

  if (value >= 0.75) {
    profile.preset = "ultrafast";
    profile.crf = Math.max(profile.crf, 32);
    scaleBitrate(profile, 0.4);
    return;
  }

  if (value >= 0.6) {
    profile.preset = "ultrafast";
    profile.crf = Math.max(profile.crf, 34);
    scaleBitrate(profile, 0.3);
    return;
  }

  profile.preset = "ultrafast";
  profile.crf = 35;
  scaleBitrate(profile, 0.25);
}

function scaleBitrate(profile: TranscodeProfile, multiplier: number): void {
  if (!profile.videoBitrateKbps) return;
  profile.videoBitrateKbps = Math.max(150, Math.round(profile.videoBitrateKbps * multiplier));
}
