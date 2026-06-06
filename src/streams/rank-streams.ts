import type { RawAggregatedStream } from "./aggregation.js";

const qualityScore: Record<string, number> = {
  "4k": 1000,
  "2160p": 980,
  "1440p": 850,
  "1080p": 750,
  "720p": 600,
  "576p": 450,
  "480p": 350,
  "360p": 250,
  "240p": 150,
  "144p": 80,
  "unknown": 0
};

const sourceScore: Record<string, number> = {
  "BluRay": 260,
  "WEB-DL": 240,
  "WEBRip": 210,
  "HDRip": 160,
  "HDTV": 140,
  "DVDRip": 120,
  "TC": -150,
  "TS": -250,
  "CAM": -450,
  "unknown": 0
};

const audioKindScore: Record<string, number> = {
  "dubbing": 700,
  "lektor": 600,
  "multi": 520,
  "original": 80,
  "subbed": 120,
  "unknown": 0
};

const codecScore: Record<string, number> = {
  "AV1": 45,
  "HEVC": 40,
  "H264": 30,
  "MPEG2": 10,
  "XVID": 5,
  "unknown": 0
};

export type StreamRankingPreferences = {
  preferredAudioLanguage: string;
  preferredSubtitleLanguage: string;
};

export type RankedStream = RawAggregatedStream & {
  score: number;
  scoreReasons: string[];
};

export function rankCandidateStreams(
  streams: RawAggregatedStream[],
  preferences: StreamRankingPreferences
): RankedStream[] {
  return streams
    .map((stream) => scoreStream(stream, preferences, stream.validation.status === "working"))
    .sort((a, b) => b.score - a.score);
}

export function rankWorkingStreams(
  streams: RawAggregatedStream[],
  preferences: StreamRankingPreferences
): RankedStream[] {
  return streams
    .filter((stream) => stream.validation.status === "working")
    .map((stream) => scoreStream(stream, preferences, true))
    .sort((a, b) => b.score - a.score);
}

export function selectBestOriginalStream(
  streams: RawAggregatedStream[],
  preferences: StreamRankingPreferences
): RankedStream | null {
  return rankWorkingStreams(streams, preferences)[0] ?? null;
}

function scoreStream(stream: RawAggregatedStream, preferences: StreamRankingPreferences, includeWorkingBonus: boolean): RankedStream {
  let score = 0;
  const scoreReasons: string[] = [];
  const rawText = `${stream.name ?? ""} ${stream.title ?? ""} ${stream.description ?? ""} ${String(stream.behaviorHints?.filename ?? "")}`;

  if (includeWorkingBonus) {
    score += addScore(scoreReasons, "working", 10_000);
  }

  const audioLanguage = stream.metadata.audioLanguage;
  if (audioLanguage === preferences.preferredAudioLanguage) {
    score += addScore(scoreReasons, `preferred audio ${preferences.preferredAudioLanguage}`, 4_000);
  } else if (audioLanguage === "multi") {
    score += addScore(scoreReasons, "multi audio", 3_200);
  }

  if (stream.metadata.subtitleLanguage === preferences.preferredSubtitleLanguage) {
    score += addScore(scoreReasons, `preferred subtitles ${preferences.preferredSubtitleLanguage}`, 700);
  }

  if (hasPreferredLanguageHint(rawText, preferences.preferredAudioLanguage)) {
    score += addScore(scoreReasons, `preferred language hint ${preferences.preferredAudioLanguage}`, 2_000);
  }

  score += addScore(scoreReasons, `quality ${stream.metadata.quality}`, qualityScore[stream.metadata.quality] ?? 0);
  score += addScore(scoreReasons, `source ${stream.metadata.source}`, sourceScore[stream.metadata.source] ?? 0);
  score += addScore(scoreReasons, `audio kind ${stream.metadata.audioKind}`, audioKindScore[stream.metadata.audioKind] ?? 0);
  score += addScore(scoreReasons, `codec ${stream.metadata.videoCodec}`, codecScore[stream.metadata.videoCodec] ?? 0);

  if (/\b(telesync|camrip|\bts\b|\bcam\b)\b/i.test(rawText)) {
    score -= addPenalty(scoreReasons, "low quality capture", 1_200);
  }

  if (/\b(dubbing\s*pl|pldub|lektor\s*pl|polish|polski|🇵🇱)\b/i.test(rawText)) {
    score += addScore(scoreReasons, "explicit Polish release", 2_500);
  }

  if (stream.validation.acceptsRanges) {
    score += addScore(scoreReasons, "range requests supported", 30);
  }

  if (stream.validation.contentLength && stream.validation.contentLength > 0) {
    score += addScore(scoreReasons, "known content length", 20);
  }

  return {
    ...stream,
    score,
    scoreReasons
  };
}

function hasPreferredLanguageHint(value: string, preferredLanguage: string): boolean {
  if (preferredLanguage === "pl") {
    return /\b(polish|polski|dubbing\s*pl|lektor\s*pl|napisy\s*pl|pldub|plsub)\b|🇵🇱/i.test(value);
  }

  return new RegExp(`\\b${preferredLanguage}\\b`, "i").test(value);
}

function addScore(scoreReasons: string[], reason: string, points: number): number {
  if (points > 0) {
    scoreReasons.push(`${reason}: +${points}`);
  }

  return points;
}

function addPenalty(scoreReasons: string[], reason: string, points: number): number {
  if (points > 0) {
    scoreReasons.push(`${reason}: -${points}`);
  }

  return points;
}
