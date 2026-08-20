// Languages the search layer can query in — a leaf module so geo, profile,
// and profilegen can all use it without import cycles. European market
// languages: a track carries a variant for a language only when local-language
// job titles are actually common in that market (English-dominant markets
// omit it).
export const SEARCH_LANGS = [
  "en", "de", "nl", "fr", "es", "it", "pl", "pt", "cs", "sk", "ro", "hu",
  "el", "sv", "da", "no", "fi", "bg", "hr", "sl", "lt", "lv", "et",
] as const;
export type SearchLang = (typeof SEARCH_LANGS)[number];
