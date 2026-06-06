import { EUROPEAN_LANGUAGES } from "../languages/european-languages.js";
import type { AudioKind, NormalizedQuality, NormalizedStreamMetadata, ReleaseSource, VideoCodec } from "./stream-metadata.js";

const qualityPatterns: Array<[RegExp, NormalizedQuality]> = [
  [/\b(4k|uhd|ultra\s*hd)\b/i, "4k"],
  [/\b2160p\b/i, "2160p"],
  [/\b1440p\b/i, "1440p"],
  [/\b1080p\b/i, "1080p"],
  [/\b720p\b/i, "720p"],
  [/\b576p\b/i, "576p"],
  [/\b480p\b/i, "480p"],
  [/\b360p\b/i, "360p"],
  [/\b240p\b/i, "240p"],
  [/\b144p\b/i, "144p"]
];

const sourcePatterns: Array<[RegExp, ReleaseSource]> = [
  [/\b(blu[- .]?ray|bdrip|brrip|bdremux|remux)\b/i, "BluRay"],
  [/\b(web[- .]?d[ l]|web[- .]?dl|webdl)\b/i, "WEB-DL"],
  [/\b(web[- .]?rip|webrip)\b/i, "WEBRip"],
  [/\bhdrip\b/i, "HDRip"],
  [/\bdvdrip\b/i, "DVDRip"],
  [/\bhdtv\b/i, "HDTV"],
  [/\b(telesync|telecine|camrip)\b/i, "TS"],
  [/\bcam\b/i, "CAM"],
  [/\bts\b/i, "TS"],
  [/\btc\b/i, "TC"]
];

const codecPatterns: Array<[RegExp, VideoCodec]> = [
  [/\bav1\b/i, "AV1"],
  [/\b(hevc|h\.265|h265|x265)\b/i, "HEVC"],
  [/\b(h\.264|h264|x264|avc)\b/i, "H264"],
  [/\bxvid\b/i, "XVID"],
  [/\bmpeg[- .]?2\b/i, "MPEG2"]
];

const sizePattern = /\b\d+(?:[.,]\d+)?\s*(?:gb|gib|mb|mib)\b/i;

export function parseStreamMetadata(input: { name?: string; title?: string; filename?: string; description?: string }): NormalizedStreamMetadata {
  const rawText = [input.name, input.title, input.filename, input.description].filter(Boolean).join(" ");
  const normalized = normalizeText(rawText);
  const matchedTokens: string[] = [];

  const quality = firstPatternMatch(normalized, qualityPatterns, matchedTokens) ?? inferQualityFromSize(normalized, matchedTokens) ?? "unknown";
  const source = firstPatternMatch(normalized, sourcePatterns, matchedTokens) ?? "unknown";
  const videoCodec = firstPatternMatch(normalized, codecPatterns, matchedTokens) ?? "unknown";
  const size = normalized.match(sizePattern)?.[0];
  if (size) matchedTokens.push(size);

  const isMultiLanguage = /\b(multi|multi audio|dual audio|dual-audio|dual|ml|polish\s*\|\s*english|english\s*\|\s*polish)\b/i.test(normalized);
  if (isMultiLanguage) matchedTokens.push("multi");

  const audioKind = detectAudioKind(normalized, matchedTokens);
  const subtitleLanguage = detectSubtitleLanguage(normalized, matchedTokens);
  const audioLanguage = detectAudioLanguage(normalized, audioKind, subtitleLanguage, isMultiLanguage, matchedTokens);
  const releaseGroup = detectReleaseGroup(rawText);

  return {
    quality,
    source,
    videoCodec,
    audioLanguage,
    subtitleLanguage,
    audioKind,
    isMultiLanguage,
    releaseGroup,
    size,
    rawText,
    matchedTokens: Array.from(new Set(matchedTokens))
  };
}

function normalizeText(value: string): string {
  return value
    .replace(/[._\-[\](){}]+/g, " ")
    .replace(/WEB D L/gi, "WEB-DL")
    .replace(/WEB DL/gi, "WEB-DL")
    .replace(/\s+/g, " ")
    .trim();
}

function firstPatternMatch<T>(value: string, patterns: Array<[RegExp, T]>, matchedTokens: string[]): T | undefined {
  for (const [pattern, result] of patterns) {
    const match = value.match(pattern);
    if (match?.[0]) {
      matchedTokens.push(match[0]);
      return result;
    }
  }

  return undefined;
}

function detectAudioKind(value: string, matchedTokens: string[]): AudioKind {
  if (/\b(dubbing\s*pl|pldub|dubbing|dubbed|dub)\b/i.test(value)) {
    matchedTokens.push("dubbing");
    return "dubbing";
  }

  if (/\b(lektor|lector|ivo|voice over|voiceover)\b/i.test(value)) {
    matchedTokens.push("lektor");
    return "lektor";
  }

  if (/\b(subbed|napisy|subtitles|subs|plsub)\b/i.test(value)) {
    matchedTokens.push("subbed");
    return "subbed";
  }

  if (/\b(multi|multi audio|dual audio|dual-audio|dual|ml)\b/i.test(value)) {
    matchedTokens.push("multi");
    return "multi";
  }

  if (/\b(original|org|vo|vost|vostfr)\b/i.test(value)) {
    matchedTokens.push("original");
    return "original";
  }

  return "unknown";
}

function detectSubtitleLanguage(value: string, matchedTokens: string[]): string | undefined {
  const subtitleHints = /\b(subbed|subtitles|subs|napisy|plsub)\b/i.test(value);
  if (!subtitleHints) {
    return undefined;
  }

  const language = detectLanguage(value);
  if (language) {
    matchedTokens.push(`sub:${language.code}`);
    return language.code;
  }

  if (/\bnapisy\b/i.test(value)) {
    matchedTokens.push("sub:pl");
    return "pl";
  }

  return undefined;
}

function detectAudioLanguage(
  value: string,
  audioKind: AudioKind,
  subtitleLanguage: string | undefined,
  isMultiLanguage: boolean,
  matchedTokens: string[]
): string | undefined {
  if (/\b(dubbing\s*pl|pldub|lektor\s*pl|polish|polski|🇵🇱)\b/i.test(value)) {
    matchedTokens.push("audio:pl");
    return isMultiLanguage ? "multi" : "pl";
  }

  const language = detectLanguage(value);
  if (!language) {
    return isMultiLanguage ? "multi" : undefined;
  }

  if (audioKind === "subbed" && subtitleLanguage === language.code && !hasExplicitAudioHint(value)) {
    return isMultiLanguage ? "multi" : undefined;
  }

  matchedTokens.push(`audio:${language.code}`);
  return isMultiLanguage ? "multi" : language.code;
}

function detectLanguage(value: string) {
  const candidates = EUROPEAN_LANGUAGES.flatMap((language) => [
    language.code,
    language.iso6392,
    language.englishName,
    language.nativeName,
    ...language.aliases
  ].filter(Boolean).map((alias) => ({ language, alias: alias as string })));

  const sorted = candidates.sort((a, b) => b.alias.length - a.alias.length);

  return sorted.find(({ alias }) => {
    const escaped = escapeRegExp(alias.toLowerCase());
    return new RegExp(`\b${escaped}\b`, "i").test(value);
  })?.language;
}

function hasExplicitAudioHint(value: string): boolean {
  return /\b(audio|lektor|lector|dubbing|dubbed|dub|multi audio|dual audio|dual)\b/i.test(value);
}

function inferQualityFromSize(value: string, matchedTokens: string[]): NormalizedQuality | undefined {
  const size = value.match(sizePattern)?.[0];
  if (!size) return undefined;
  const number = Number.parseFloat(size.replace(",", "."));
  const isMb = /mb|mib/i.test(size);
  const gb = isMb ? number / 1024 : number;
  if (!Number.isFinite(gb)) return undefined;

  if (gb >= 12) {
    matchedTokens.push("quality inferred from large size");
    return "2160p";
  }
  if (gb >= 4) {
    matchedTokens.push("quality inferred from size");
    return "1080p";
  }
  if (gb >= 1.2) {
    matchedTokens.push("quality inferred from size");
    return "720p";
  }
  if (gb >= 0.55) {
    matchedTokens.push("quality inferred from size");
    return "480p";
  }

  return undefined;
}

function detectReleaseGroup(rawText: string): string | undefined {
  const match = rawText.match(/[-–—]\s*([A-Za-z0-9][A-Za-z0-9._-]{1,30})\s*$/);
  return match?.[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
