import { DEFAULT_PREFERRED_LANGUAGE, EUROPEAN_LANGUAGES, findEuropeanLanguage, type LanguageDefinition } from "../languages/european-languages.js";
import type { ExternalSubtitle } from "./animesub-client.js";

const LANGUAGE_BY_CODE = new Map(EUROPEAN_LANGUAGES.map((language) => [language.code, language]));

export function normalizeSubtitleLanguageCode(value: string | undefined, fallback = DEFAULT_PREFERRED_LANGUAGE): string {
  const normalized = normalizeText(value ?? "");
  if (!normalized) return fallback;
  const direct = findEuropeanLanguage(normalized);
  if (direct) return direct.code;
  const short = normalized.split(/[^a-z0-9]+/).filter(Boolean)[0];
  const byToken = short ? findEuropeanLanguage(short) : undefined;
  return byToken?.code ?? fallback;
}

export function detectSubtitleLanguageCode(subtitle: Pick<ExternalSubtitle, "lang" | "id" | "name" | "url"> | undefined): string | undefined {
  if (!subtitle) return undefined;
  const direct = matchLanguageInText(subtitle.lang ?? "", true);
  if (direct) return direct.code;
  const detected = matchLanguageInText([subtitle.name, subtitle.id, subtitle.url].filter(Boolean).join(" "), false);
  return detected?.code;
}

export function matchesSubtitleLanguage(subtitle: Pick<ExternalSubtitle, "lang" | "id" | "name" | "url"> | undefined, expectedLanguageCode: string): boolean {
  const expected = LANGUAGE_BY_CODE.get(normalizeSubtitleLanguageCode(expectedLanguageCode));
  if (!expected || !subtitle) return false;
  if (matchesLanguage(subtitle.lang ?? "", expected, true)) return true;
  return matchesLanguage([subtitle.name, subtitle.id, subtitle.url].filter(Boolean).join(" "), expected, false);
}

export function toStremioSubtitleLang(subtitle: Pick<ExternalSubtitle, "lang" | "id" | "name" | "url"> | undefined, fallbackLanguageCode = DEFAULT_PREFERRED_LANGUAGE): string {
  const detected = detectSubtitleLanguageCode(subtitle);
  const language = LANGUAGE_BY_CODE.get(detected ?? normalizeSubtitleLanguageCode(subtitle?.lang, fallbackLanguageCode));
  if (language?.iso6392) return language.iso6392;
  if (language?.code) return language.code;
  const normalized = normalizeText(subtitle?.lang ?? fallbackLanguageCode);
  if (["jp", "ja", "jpn", "japanese"].includes(normalized)) return "jpn";
  if (normalized.length === 2) return normalized;
  return normalized.slice(0, 12) || "pol";
}

function matchLanguageInText(value: string, strict: boolean): LanguageDefinition | undefined {
  return EUROPEAN_LANGUAGES.find((language) => matchesLanguage(value, language, strict));
}

function matchesLanguage(value: string, language: LanguageDefinition, strict: boolean): boolean {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return false;
  const aliases = languageAliases(language);
  if (strict) return aliases.has(normalizedValue);

  const tokens = tokenize(normalizedValue);
  for (const alias of aliases) {
    if (tokens.has(alias)) return true;
    if (alias.includes(" ") && hasPhrase(normalizedValue, alias)) return true;
  }
  return false;
}

function languageAliases(language: LanguageDefinition): Set<string> {
  return new Set([language.code, language.iso6392, language.englishName, language.nativeName, ...language.aliases].filter(Boolean).map((value) => normalizeText(String(value))).filter(Boolean));
}

function hasPhrase(value: string, phrase: string): boolean {
  return ` ${value} `.includes(` ${phrase} `);
}

function tokenize(value: string): Set<string> {
  return new Set(value.split(/[^a-z0-9]+/).filter(Boolean));
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}
