import { getAppSettings } from "../settings/app-settings.js";
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
  docchiIndexing?: DocchiIndexingRankingHints;
};

export type DocchiIndexingRankingHints = {
  enabled: boolean;
  title?: string;
  ids: Array<{ season: number; episode: number; label: string }>;
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
  const settings = getAppSettings();
  const rawText = `${stream.name ?? ""} ${stream.title ?? ""} ${stream.description ?? ""} ${String(stream.behaviorHints?.filename ?? "")}`;
  const normalizedRawText = normalizeSearchText(rawText);

  if (includeWorkingBonus) {
    score += addScore(scoreReasons, "working", 10_000);
  }

  if (settings.preferDebrid && hasDebridHint(rawText)) {
    score += addScore(scoreReasons, "preferred debrid source", 5_000);
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

  score += scoreDocchiIndexingHints(scoreReasons, rawText, normalizedRawText, preferences.docchiIndexing);
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

  Object.assign(stream, { score, scoreReasons });
  return stream as RankedStream;
}

function scoreDocchiIndexingHints(scoreReasons: string[], rawText: string, normalizedRawText: string, hints?: DocchiIndexingRankingHints): number {
  if (!hints?.enabled) return 0;

  let score = 0;
  const matchedEpisodeLabels = new Set<string>();
  for (const item of hints.ids) {
    if (item.season <= 0 || item.episode <= 0) continue;
    if (!hasSeasonEpisodeHint(rawText, item.season, item.episode)) continue;
    const label = `docchi indexed episode ${item.label}`;
    if (matchedEpisodeLabels.has(label)) continue;
    matchedEpisodeLabels.add(label);
    score += addScore(scoreReasons, label, 5_000);
  }

  const title = normalizeSearchText(hints.title ?? "");
  if (title && normalizedRawText.includes(title)) {
    score += addScore(scoreReasons, `docchi indexed title "${hints.title}"`, 5_050);
  }

  const titleWords = splitTitleWords(hints.title ?? "");
  for (const word of titleWords) {
    if (!containsNormalizedWord(normalizedRawText, word)) continue;
    score += addScore(scoreReasons, `docchi indexed title word "${word}"`, 2_500);
  }

  return score;
}

function hasSeasonEpisodeHint(value: string, season: number, episode: number): boolean {
  const seasonText = String(season).padStart(2, "0");
  const episodeText = String(episode).padStart(2, "0");
  const looseEpisode = String(episode);
  const patterns = [
    new RegExp(`\\bS0?${season}\\s*[. _-]?\\s*E0?${episode}\\b`, "i"),
    new RegExp(`\\b${seasonText}x${episodeText}\\b`, "i"),
    new RegExp(`\\bseason\\s*0?${season}\\b[\\s\\S]{0,30}\\b(?:episode|ep)\\s*0?${episode}\\b`, "i"),
    new RegExp(`\\bsezon\\s*0?${season}\\b[\\s\\S]{0,30}\\b(?:odcinek|odc|ep)\\s*0?${episode}\\b`, "i"),
    new RegExp(`\\bS0?${season}E${looseEpisode}\\b`, "i")
  ];
  return patterns.some((pattern) => pattern.test(value));
}

function splitTitleWords(value: string): string[] {
  return normalizeSearchText(value)
    .split(" ")
    .filter((word) => word.length >= 3 && !isWeakTitleWord(word));
}

function containsNormalizedWord(value: string, word: string): boolean {
  return new RegExp(`(^|\\s)${escapeRegExp(word)}($|\\s)`, "i").test(value);
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ąćęłńóśźż]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isWeakTitleWord(value: string): boolean {
  return /^(a|an|and|by|da|de|do|drogi|dla|el|i|in|la|le|na|no|of|po|the|to|u|w|we|z|za)$/i.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasDebridHint(value: string): boolean {
  return /\[(?:RD\s*(?:⚡|\+)?|PM\+?|AD\+?)\]|\b(?:real[-\s]?debrid|alldebrid|all[-\s]?debrid|premiumize|debrid)\b/i.test(value);
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
