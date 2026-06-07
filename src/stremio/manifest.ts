import { listEnabledLibraries } from "../libraries/library-registry.js";
import { DEFAULT_PREFERRED_LANGUAGE, EUROPEAN_LANGUAGES } from "../languages/european-languages.js";

export const TRANSCODE_QUALITIES = [
  "auto",
  "4k",
  "1440p",
  "1080p",
  "720p",
  "480p",
  "360p",
  "240p",
  "144p"
] as const;

export type TranscodeQuality = typeof TRANSCODE_QUALITIES[number];

export const BUFFER_PRESETS = [
  "disabled",
  "auto",
  "2s",
  "5s",
  "10s",
  "15s",
  "20s",
  "30s",
  "45s",
  "60s"
] as const;

export type BufferPreset = typeof BUFFER_PRESETS[number];

const baseManifest = {
  id: "community.selfhosted.stream.aggregator",
  version: "0.1.0",
  name: "SelfHosted Stream Aggregator",
  description:
    "Aggregates configured Stremio/Nuvio-compatible addons, validates streams, matches European audio/subtitle languages and exposes Original/Auto/transcoded options.",
  logo: "https://dummyimage.com/256x256/222/fff.png&text=SSA",
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  behaviorHints: {
    configurable: true,
    configurationRequired: false
  },
  config: [
    {
      key: "preferredAudioLanguage",
      type: "select",
      title: "Preferred audio language",
      default: DEFAULT_PREFERRED_LANGUAGE,
      options: EUROPEAN_LANGUAGES.map((language) => ({
        value: language.code,
        label: `${language.nativeName} / ${language.englishName}`
      }))
    },
    {
      key: "preferredSubtitleLanguage",
      type: "select",
      title: "Preferred subtitle language",
      default: DEFAULT_PREFERRED_LANGUAGE,
      options: EUROPEAN_LANGUAGES.map((language) => ({
        value: language.code,
        label: `${language.nativeName} / ${language.englishName}`
      }))
    },
    {
      key: "transcodeBufferPreset",
      type: "select",
      title: "Transcode buffer",
      default: "auto",
      options: [
        { value: "disabled", label: "Wyłączony" },
        { value: "auto", label: "Automatyczny bufor" },
        { value: "2s", label: "2 sek" },
        { value: "5s", label: "5 sek" },
        { value: "10s", label: "10 sek" },
        { value: "15s", label: "15 sek" },
        { value: "20s", label: "20 sek" },
        { value: "30s", label: "30 sek" },
        { value: "45s", label: "45 sek" },
        { value: "60s", label: "60 sek" }
      ]
    }
  ]
};

export function getAddonManifest() {
  const libraries = listEnabledLibraries();
  return {
    ...baseManifest,
    resources: libraries.length ? ["stream", "catalog", "meta"] : ["stream"],
    catalogs: libraries.map((library) => ({
      type: library.type,
      id: library.slug,
      name: library.name,
      extra: [{ name: "skip", isRequired: false }]
    }))
  };
}
