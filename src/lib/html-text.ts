// HTML → readable plain text, structure preserved.
//
// The bug this replaces: the old stripHtml removed tags FIRST and decoded
// entities SECOND. Greenhouse (our largest ATS source) returns its content
// HTML-ENCODED, so the tag regex matched nothing and the decode step then
// MANIFESTED real tags into the stored text. Measured consequence: 47-58% of
// a stored Greenhouse description was markup — half of every prompt window,
// every embedding and every keyword scan was spent on `<span style=...>`.
//
// Structure is preserved on purpose. Everything downstream wants to know
// where a posting's sections begin, and headings/bullets are the only clue a
// posting gives; flattening whitespace destroyed that signal before any
// consumer could see it.

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'",
  "#x27": "'", "#x2F": "/", "#47": "/", "#160": " ", hellip: "…", mdash: "—",
  ndash: "–", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", bull: "•",
  eacute: "é", uuml: "ü", ouml: "ö", auml: "ä", szlig: "ß", euro: "€", middot: "·",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, name: string) => {
    const key = name.toLowerCase();
    if (ENTITIES[name] !== undefined) return ENTITIES[name];
    if (ENTITIES[key] !== undefined) return ENTITIES[key];
    if (/^#x/i.test(name)) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (/^#/.test(name)) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return m;
  });
}

const BLOCK_END = /<\/(p|div|h[1-6]|li|ul|ol|tr|table|section|article|blockquote)\s*>/gi;
const BREAK = /<(br|hr)\s*\/?>/gi;
const LIST_ITEM = /<li[^>]*>/gi;
const HEADING_OPEN = /<h[1-6][^>]*>/gi;

export function htmlToText(input: string | undefined | null): string {
  if (!input) return "";
  // Decode FIRST (twice: some feeds double-encode), so escaped markup is
  // treated as markup instead of surviving as literal text.
  let s = decodeEntities(decodeEntities(input));
  // Script/style bodies carry no posting content but plenty of noise.
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Turn structure into newlines BEFORE dropping tags.
  s = s.replace(BREAK, "\n");
  s = s.replace(LIST_ITEM, "\n- ");
  s = s.replace(HEADING_OPEN, "\n\n");
  s = s.replace(BLOCK_END, "\n");
  // Remaining tags carry no text.
  s = s.replace(/<[^>]+>/g, " ");
  // Collapse horizontal whitespace only — newlines are the structure we just
  // rescued. Cap blank runs at one so the text stays compact.
  s = s.replace(/[ \t ]+/g, " ");
  s = s.replace(/ *\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

// True when a stored description still carries markup — the repair queue.
export function looksLikeHtml(text: string): boolean {
  return /<(p|div|li|br|span|strong|em|h[1-6]|ul|ol|table)\b[^>]*>/i.test(text) ||
    /&(lt|gt|amp|nbsp|#\d+);/i.test(text);
}
