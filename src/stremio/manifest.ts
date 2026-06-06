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

export const addonManifest = {
  id: "community.selfhosted.stream.aggregator",
  version: "0.1.0",
  name: "SelfHosted Stream Aggregator",
  description:
    "Aggregates configured Stremio/Nuvio-compatible addons, validates streams, matches European audio/subtitle languages and exposes Original/Auto/transcoded options.",
  logo: "https://dummyimage.com/256x256/222/fff.png&text=SSA",
  resources: ["stream"],
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
    }
  ]
};
