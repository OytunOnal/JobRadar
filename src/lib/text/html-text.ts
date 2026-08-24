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

// Stamped onto JobContent.textVersion by everything that writes a
// description. Bump it when a change to this file would produce materially
// different stored text, so the backfill knows what is stale.
//   (unset) — the old stripHtml: entities decoded after tags were stripped,
//             and \s+ collapsed, so escaped markup was manifested into the
//             text and all paragraph structure was destroyed.
//   t2      — htmlToText: decode first, block tags to newlines, horizontal
//             whitespace only. Decoding first also meant a decoded "&lt;" in
//             prose opened a fake tag, so "&lt; 100ms … &gt; 99%" lost every
//             word between the two.
//   t3      — a tag must start like a tag (`<` then a letter, `/` or `!`).
//             Rows written by t2 may be missing requirement text and cannot
//             be repaired offline — the words are gone — so they are stale by
//             version and get re-fetched.
export const TEXT_VERSION = "t3";

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'",
  "#x27": "'", "#x2F": "/", "#47": "/", "#160": " ", hellip: "…", mdash: "—",
  ndash: "–", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", bull: "•",
  eacute: "é", uuml: "ü", ouml: "ö", auml: "ä", szlig: "ß", euro: "€", middot: "·",
};

// Anything unrecognised is left exactly as written. A job posting is hostile
// input by default — some carry deliberate prompt injections — so this decodes
// only what it knows and refuses to be creative about the rest.
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, name: string) => {
    // hasOwn, not `!== undefined`: a plain object literal inherits from
    // Object.prototype, so `ENTITIES["toString"]` is a FUNCTION. A posting
    // writing "&toString;" had the source of Object.prototype.toString spliced
    // into its description, and from there into the embedding and the prompt.
    if (Object.hasOwn(ENTITIES, name)) return ENTITIES[name];
    const key = name.toLowerCase();
    if (Object.hasOwn(ENTITIES, key)) return ENTITIES[key];

    // Numeric references, bounds-checked. String.fromCodePoint THROWS on
    // anything above U+10FFFF, and this runs inside every connector's map()
    // inside the source fetch — so one posting with "&#1234567;" made that
    // whole source contribute nothing for the run, reported as a generic
    // fetch error.
    const numeric = /^#x/i.test(name)
      ? parseInt(name.slice(2), 16)
      : /^#/.test(name)
        ? parseInt(name.slice(1), 10)
        : NaN;
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0x10ffff) return m;
    // Lone surrogates are unpaired halves — unserializable, and they killed a
    // desc-fill run once already through a different route.
    if (numeric >= 0xd800 && numeric <= 0xdfff) return m;
    return String.fromCodePoint(numeric);
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
  // Empty list items are common in the wild — postings published with
  // `<li><strong>&nbsp;</strong></li>` placeholders (verified on a live
  // Greenhouse board). Rendering them as bare "-" lines spends prompt tokens
  // on nothing and makes a section look populated when it is not.
  //
  // Removed HERE, while they are still list items, rather than by deleting
  // lone "-" lines from the finished text: that later pass could not tell our
  // own empty bullet from a dash the posting actually wrote.
  s = s.replace(/<li[^>]*>[\s\S]*?<\/li>/gi, (item) =>
    /[\p{L}\p{N}]/u.test(item.replace(/<[^>]+>/g, "")) ? item : "");
  // Turn structure into newlines BEFORE dropping tags.
  s = s.replace(BREAK, "\n");
  s = s.replace(LIST_ITEM, "\n- ");
  s = s.replace(HEADING_OPEN, "\n\n");
  s = s.replace(BLOCK_END, "\n");
  // Remaining tags carry no text.
  //
  // A tag must START like one: `<` followed by a letter, `/` or `!`. The
  // looser `<[^>]+>` treated any `<`…`>` span as markup, and since entities
  // are decoded FIRST, a posting written "&lt; 100ms" / "&gt; 99%" became
  // "< 100ms … > 99%" and everything between the two was deleted as a tag.
  // Verified: "Latency must be &lt; 100ms and uptime &gt; 99%." collapsed to
  // "Latency must be 99%.", and "&lt;3 years exp &gt; junior" to "junior" —
  // requirement text, silently removed, in the stage that exists to preserve
  // requirement text.
  s = s.replace(/<\/?[a-zA-Z!][^>]*>/g, " ");
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
