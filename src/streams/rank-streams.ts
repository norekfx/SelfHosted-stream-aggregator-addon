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
  "TC": 60,
  "TS": 40,
  "CAM": 20,
  "unknown": 0
};

const audioKindScore: Record<string, number> = {
  "dubbing": 90,
  "lektor": 80,
  "multi": 70,
  "original": 50,
  "subbed": 40,
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

export function rankWorkingStreams(
  streams: RawAggregatedStream[],
  preferences: StreamRankingPreferences
): RankedStream[] {
  return streams
    .filter((stream) => stream.validation.status === "working")
    .map((stream) => scoreStream(stream, preferences))
    .sort((a, b) => b.score - a.score);
}

export function selectBestOriginalStream(
  streams: RawAggregatedStream[],
  preferences: StreamRankingPreferences
): RankedStream | null {
  return rankWorkingStreams(streams, preferences)[0] ?? null;
}

function scoreStream(stream: RawAggregatedStream, preferences: StreamRankingPreferences): RankedStream {
  let score = 0;
  const scoreReasons: string[] = [];

  score += addScore(scoreReasons, "working", 10_000);

  const audioLanguage = stream.metadata.audioLanguage;
  if (audioLanguage === preferences.preferredAudioLanguage) {
    score += addScore(scoreReasons, `preferred audio ${preferences.preferredAudioLanguage}`, 2_000);
  } else if (audioLanguage === "multi") {
    score += addScore(scoreReasons, "multi audio", 1_500);
  }

  if (stream.metadata.subtitleLanguage === preferences.preferredSubtitleLanguage) {
    score += addScore(scoreReasons, `preferred subtitles ${preferences.preferredSubtitleLanguage}`, 500);
  }

  score += addScore(scoreReasons, `quality ${stream.metadata.quality}`, qualityScore[stream.metadata.quality] ?? 0);
  score += addScore(scoreReasons, `source ${stream.metadata.source}`, sourceScore[stream.metadata.source] ?? 0);
  score += addScore(scoreReasons, `audio kind ${stream.metadata.audioKind}`, audioKindScore[stream.metadata.audioKind] ?? 0);
  score += addScore(scoreReasons, `codec ${stream.metadata.videoCodec}`, codecScore[stream.metadata.videoCodec] ?? 0);

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

function addScore(scoreReasons: string[], reason: string, points: number): number {
  if (points > 0) {
    scoreReasons.push(`${reason}: +${points}`);
  }

  return points;
}
