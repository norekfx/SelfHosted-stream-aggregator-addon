export type LanguageDefinition = {
  /** ISO 639-1 when available, otherwise a stable project code. */
  code: string;
  /** ISO 639-2/T code when useful for media filenames and metadata. */
  iso6392?: string;
  englishName: string;
  nativeName: string;
  aliases: string[];
};

/**
 * European languages commonly needed for audio/subtitle matching.
 * Polish is intentionally included with rich aliases used in release names.
 */
export const EUROPEAN_LANGUAGES: LanguageDefinition[] = [
  { code: "sq", iso6392: "sqi", englishName: "Albanian", nativeName: "Shqip", aliases: ["albanian", "shqip", "alb", "sqi"] },
  { code: "hy", iso6392: "hye", englishName: "Armenian", nativeName: "Հայերեն", aliases: ["armenian", "hayeren", "arm", "hye"] },
  { code: "az", iso6392: "aze", englishName: "Azerbaijani", nativeName: "Azərbaycanca", aliases: ["azerbaijani", "azeri", "aze"] },
  { code: "eu", iso6392: "eus", englishName: "Basque", nativeName: "Euskara", aliases: ["basque", "euskara", "baq", "eus"] },
  { code: "be", iso6392: "bel", englishName: "Belarusian", nativeName: "Беларуская", aliases: ["belarusian", "belorussian", "bel"] },
  { code: "bs", iso6392: "bos", englishName: "Bosnian", nativeName: "Bosanski", aliases: ["bosnian", "bosanski", "bos"] },
  { code: "br", iso6392: "bre", englishName: "Breton", nativeName: "Brezhoneg", aliases: ["breton", "brezhoneg", "bre"] },
  { code: "bg", iso6392: "bul", englishName: "Bulgarian", nativeName: "Български", aliases: ["bulgarian", "bul", "bg"] },
  { code: "ca", iso6392: "cat", englishName: "Catalan", nativeName: "Català", aliases: ["catalan", "catala", "cat"] },
  { code: "hr", iso6392: "hrv", englishName: "Croatian", nativeName: "Hrvatski", aliases: ["croatian", "hrvatski", "hrv", "scr"] },
  { code: "cs", iso6392: "ces", englishName: "Czech", nativeName: "Čeština", aliases: ["czech", "ces", "cze", "cz"] },
  { code: "da", iso6392: "dan", englishName: "Danish", nativeName: "Dansk", aliases: ["danish", "dansk", "dan"] },
  { code: "nl", iso6392: "nld", englishName: "Dutch", nativeName: "Nederlands", aliases: ["dutch", "nederlands", "nld", "dut"] },
  { code: "en", iso6392: "eng", englishName: "English", nativeName: "English", aliases: ["english", "eng", "original", "vo"] },
  { code: "et", iso6392: "est", englishName: "Estonian", nativeName: "Eesti", aliases: ["estonian", "eesti", "est"] },
  { code: "fo", iso6392: "fao", englishName: "Faroese", nativeName: "Føroyskt", aliases: ["faroese", "foroyskt", "fao"] },
  { code: "fi", iso6392: "fin", englishName: "Finnish", nativeName: "Suomi", aliases: ["finnish", "suomi", "fin"] },
  { code: "fr", iso6392: "fra", englishName: "French", nativeName: "Français", aliases: ["french", "francais", "fra", "fre", "vf", "vff"] },
  { code: "fy", iso6392: "fry", englishName: "Western Frisian", nativeName: "Frysk", aliases: ["frisian", "western frisian", "frysk", "fry"] },
  { code: "gl", iso6392: "glg", englishName: "Galician", nativeName: "Galego", aliases: ["galician", "galego", "glg"] },
  { code: "ka", iso6392: "kat", englishName: "Georgian", nativeName: "ქართული", aliases: ["georgian", "kartuli", "geo", "kat"] },
  { code: "de", iso6392: "deu", englishName: "German", nativeName: "Deutsch", aliases: ["german", "deutsch", "ger", "deu"] },
  { code: "el", iso6392: "ell", englishName: "Greek", nativeName: "Ελληνικά", aliases: ["greek", "ell", "gre"] },
  { code: "hu", iso6392: "hun", englishName: "Hungarian", nativeName: "Magyar", aliases: ["hungarian", "magyar", "hun"] },
  { code: "is", iso6392: "isl", englishName: "Icelandic", nativeName: "Íslenska", aliases: ["icelandic", "islenska", "ice", "isl"] },
  { code: "ga", iso6392: "gle", englishName: "Irish", nativeName: "Gaeilge", aliases: ["irish", "gaeilge", "gle"] },
  { code: "it", iso6392: "ita", englishName: "Italian", nativeName: "Italiano", aliases: ["italian", "italiano", "ita"] },
  { code: "kk", iso6392: "kaz", englishName: "Kazakh", nativeName: "Қазақша", aliases: ["kazakh", "kaz"] },
  { code: "lb", iso6392: "ltz", englishName: "Luxembourgish", nativeName: "Lëtzebuergesch", aliases: ["luxembourgish", "letzebuergesch", "ltz"] },
  { code: "lv", iso6392: "lav", englishName: "Latvian", nativeName: "Latviešu", aliases: ["latvian", "latviesu", "lav"] },
  { code: "lt", iso6392: "lit", englishName: "Lithuanian", nativeName: "Lietuvių", aliases: ["lithuanian", "lietuviu", "lit"] },
  { code: "mk", iso6392: "mkd", englishName: "Macedonian", nativeName: "Македонски", aliases: ["macedonian", "mkd", "mac"] },
  { code: "mt", iso6392: "mlt", englishName: "Maltese", nativeName: "Malti", aliases: ["maltese", "malti", "mlt"] },
  { code: "mo", iso6392: "mol", englishName: "Moldovan", nativeName: "Moldovenească", aliases: ["moldovan", "moldavian", "mol"] },
  { code: "me", englishName: "Montenegrin", nativeName: "Crnogorski", aliases: ["montenegrin", "crnogorski", "cnr", "me"] },
  { code: "no", iso6392: "nor", englishName: "Norwegian", nativeName: "Norsk", aliases: ["norwegian", "norsk", "nor", "nb", "nn", "nob", "nno"] },
  { code: "pl", iso6392: "pol", englishName: "Polish", nativeName: "Polski", aliases: ["polish", "polski", "pol", "pl", "lektor", "lektor pl", "dubbing pl", "napisy pl", "lector", "ivo", "pldub", "plsub"] },
  { code: "pt", iso6392: "por", englishName: "Portuguese", nativeName: "Português", aliases: ["portuguese", "portugues", "por", "pt-pt"] },
  { code: "ro", iso6392: "ron", englishName: "Romanian", nativeName: "Română", aliases: ["romanian", "romana", "rum", "ron"] },
  { code: "rm", iso6392: "roh", englishName: "Romansh", nativeName: "Rumantsch", aliases: ["romansh", "rumantsch", "roh"] },
  { code: "ru", iso6392: "rus", englishName: "Russian", nativeName: "Русский", aliases: ["russian", "rus", "ru"] },
  { code: "gd", iso6392: "gla", englishName: "Scottish Gaelic", nativeName: "Gàidhlig", aliases: ["scottish gaelic", "gaelic", "gaidhlig", "gla"] },
  { code: "sr", iso6392: "srp", englishName: "Serbian", nativeName: "Српски", aliases: ["serbian", "srpski", "srp", "scc"] },
  { code: "sk", iso6392: "slk", englishName: "Slovak", nativeName: "Slovenčina", aliases: ["slovak", "slovencina", "slo", "slk"] },
  { code: "sl", iso6392: "slv", englishName: "Slovenian", nativeName: "Slovenščina", aliases: ["slovenian", "slovenscina", "slv"] },
  { code: "es", iso6392: "spa", englishName: "Spanish", nativeName: "Español", aliases: ["spanish", "espanol", "castellano", "spa", "es-es"] },
  { code: "sv", iso6392: "swe", englishName: "Swedish", nativeName: "Svenska", aliases: ["swedish", "svenska", "swe"] },
  { code: "tr", iso6392: "tur", englishName: "Turkish", nativeName: "Türkçe", aliases: ["turkish", "turkce", "tur"] },
  { code: "uk", iso6392: "ukr", englishName: "Ukrainian", nativeName: "Українська", aliases: ["ukrainian", "ukr", "ua"] },
  { code: "cy", iso6392: "cym", englishName: "Welsh", nativeName: "Cymraeg", aliases: ["welsh", "cymraeg", "wel", "cym"] },
  { code: "yi", iso6392: "yid", englishName: "Yiddish", nativeName: "ייִדיש", aliases: ["yiddish", "yid"] }
];

export const DEFAULT_PREFERRED_LANGUAGE = "pl";

export function findEuropeanLanguage(input: string): LanguageDefinition | undefined {
  const normalized = input.trim().toLowerCase();
  return EUROPEAN_LANGUAGES.find((language) =>
    language.code === normalized ||
    language.iso6392 === normalized ||
    language.aliases.some((alias) => alias.toLowerCase() === normalized)
  );
}
