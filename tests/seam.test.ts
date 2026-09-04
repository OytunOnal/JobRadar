import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { looksLikeHtml, htmlToText } from "../src/lib/text/html-text";
import { mapHit } from "../src/lib/sources/wttj";
import { cardToRawJob } from "../src/lib/sources/arbeitsagentur";
import { parseFeed } from "../src/lib/sources/rssfeeds";

// The seam between a connector and ingest carries `description: string` with
// nothing that says whether it has been converted. A census found three body
// fields assigned raw, two of them in files that imported no converter at all.

test("the narrow detector tells markup from synthesized prose", () => {
  // Why ingest cannot simply convert everything: several connectors build a
  // plain-text description by hand, and htmlToText treats `<` plus a letter as
  // a tag — so a stack listing would lose everything up to the next `>`.
  assert.equal(looksLikeHtml("<p>We are hiring</p>"), true);
  assert.equal(looksLikeHtml("Requirements &lt;/li&gt;"), true);
  assert.equal(looksLikeHtml("Technologies: React, <T>, <canvas>, Rust."), false);
  assert.equal(looksLikeHtml("Senior Unity Developer · games · senior"), false);
  // And the harm the detector avoids, demonstrated exactly — no more, no less.
  // The tag regex requires `<` then a letter, so `< 100ms` in prose is safe,
  // but a bracketed token in a stack listing IS deleted. The surrounding text
  // survives, because the match stops at the first `>`.
  assert.equal(htmlToText("Technologies: <T>, <canvas>, Rust."), "Technologies: , , Rust.");
  assert.equal(htmlToText("Latency < 100ms"), "Latency < 100ms");
});

test("wttj's profil recherché arrives as text, not as markup", () => {
  const job = mapHit({
    slug: "backend-engineer", name: "Engineer",
    organization: { name: "Acme", slug: "acme" },
    profile: "<p>5 ans d'expérience</p><ul><li>Go</li></ul>",
  } as never);
  assert.ok(job);
  assert.equal(looksLikeHtml(job!.description), false);
  assert.ok(job!.description.includes("expérience"));
});

test("the BA detail body arrives as text", () => {
  const job = cardToRawJob(
    { refnr: "1", titel: "Entwickler", arbeitgeber: "Acme", arbeitsort: { ort: "Berlin" } } as never,
    { description: "<p>Wir suchen</p><ul><li>Java</li></ul>" },
  );
  assert.equal(looksLikeHtml(job.description), false);
  assert.ok(job.description.includes("Java"));
});

test("an RSS feed no longer manifests markup back into the stored text", () => {
  // decode() used to run AFTER stripHtml, so a double-escaped tag surviving
  // the two internal decodes became a real tag in the final text — the exact
  // ordering the html-text rewrite exists to prevent, across 66 feeds.
  const xml = `<rss><channel><item>
    <title>Backend Engineer at Acme</title>
    <link>https://acme.example/j/1</link>
    <description>Latency must be &amp;lt;p&amp;gt; below 100ms</description>
  </item></channel></rss>`;
  const jobs = parseFeed(xml, { label: "Test", company: "author", url: "x" } as never);
  assert.equal(jobs.length, 1);
  assert.equal(looksLikeHtml(jobs[0].description), false, jobs[0].description);
});

// The three that were assigned raw are fixed; this stops a fourth appearing.
//
// File-level on purpose. The defect the census actually found was not a subtle
// expression — it was two connectors that imported no converter AT ALL and so
// could not have converted their body even if someone had noticed. A line-level
// regex tries to read intent out of an expression and gets it wrong both ways;
// "this file produces descriptions and owns no way to convert one" does not.
test("a connector that produces descriptions can convert them", () => {
  // Connectors whose description is synthesized plain text or a title echo,
  // and which must NOT gain a converter — htmlToText eats `<T>` and `<canvas>`.
  const NO_BODY = new Map([
    ["swissdevjobs.ts", "synthesizes a plain sentence from structured fields"],
    ["germantechjobs.ts", "same board engine, same synthesis"],
    ["thehub.ts", "list payload has no body; description is the title"],
    ["vdab.ts", "light search payload has no body; description is the title"],
    ["companies.ts", "delegates to the ATS fetchers; produces none itself"],
    ["apify.ts", "a transport helper, not a connector"],
    ["types.ts", "the seam itself"],
  ]);

  const offenders: string[] = [];
  for (const rel of readdirSync("src/lib/sources", { recursive: true }) as string[]) {
    const name = String(rel);
    if (!name.endsWith(".ts") || NO_BODY.has(name)) continue;
    const src = readFileSync(join("src/lib/sources", name), "utf8");
    if (!/description:\s/.test(src)) continue;
    const converts = /(stripHtml|htmlToText|labelledSections)/.test(src);
    if (!converts) offenders.push(`sources/${name}`);
  }

  assert.deepEqual(
    offenders,
    [],
    "these produce descriptions with no way to convert one — import stripHtml, "
      + "or add them to NO_BODY with a reason: " + offenders.join(", "),
  );
});

// ── The sections half of the seam ────────────────────────────────────────

test("a source's named blocks travel as parts, and ingest assembles them", async () => {
  const { leverSections } = await import("../src/lib/sources/ats");
  const { labelledSections } = await import("../src/lib/text/sections");

  const parts = leverSections({
    description: "<p>We build tools.</p>",
    lists: [{ text: "Requirements", content: "<ul><li>5 years Go</li></ul>" }],
    additional: "<p>Equal opportunity employer.</p>",
  });
  // The connector's answer is which blocks the SOURCE named — nothing about
  // headings, order or format, which are ours and move with the parser.
  assert.deepEqual(parts.map((p) => p[0]), ["", "Requirements", ""]);

  const text = labelledSections(parts);
  assert.match(text, /Requirements:\n/);
  assert.ok(text.includes("5 years Go"));
});

test("an adapter's own description survives as the fallback", async () => {
  const { leverSections } = await import("../src/lib/sources/ats");
  const { labelledSections } = await import("../src/lib/text/sections");
  // Every named block empty: the assembly is empty, so ingest keeps whatever
  // the adapter put in `description` — Lever's structure-destroyed plain text,
  // Personio's unpaired <value> blocks, or a bare title.
  assert.equal(labelledSections(leverSections({ lists: [] })), "");
});

test("no connector assembles sections itself", () => {
  // Eight did, which meant eight places to change when the parser changed and
  // a ninth that would have done it differently.
  const offenders: string[] = [];
  for (const rel of readdirSync("src/lib/sources", { recursive: true }) as string[]) {
    const name = String(rel);
    if (!name.endsWith(".ts")) continue;
    const src = readFileSync(join("src/lib/sources", name), "utf8");
    if (/\blabelledSections\s*\(/.test(src)) offenders.push(`sources/${name}`);
  }
  assert.deepEqual(offenders, [], "report sections; let ingest assemble: " + offenders.join(", "));
});

// ── Detail fetching belongs to one place ─────────────────────────────────

test("no connector scores a posting or keeps a copy of the store gate", () => {
  // Four did, each with its own `const SCORE_GATE = 20` and the same comment
  // explaining why importing the real one was impossible. They used it to
  // decide which cards deserved a detail call — and, in doing so, which cards
  // the pool was allowed to contain at all.
  const offenders: string[] = [];
  for (const rel of readdirSync("src/lib/sources", { recursive: true }) as string[]) {
    const name = String(rel);
    if (!name.endsWith(".ts")) continue;
    const src = readFileSync(join("src/lib/sources", name), "utf8");
    if (/\bscoreJob\b/.test(src)) offenders.push(`sources/${name} — scores`);
    if (/SCORE_GATE\s*=/.test(src)) offenders.push(`sources/${name} — own store gate`);
  }
  assert.deepEqual(offenders, [], "the store gate is derive.ts's: " + offenders.join(", "));
});

test("every source that defers its body is in desc:fill's queue", () => {
  // Removing the in-connector detail fetch is only half the change; if the
  // backfill does not claim those sources, the postings simply never get a
  // body. Both halves or neither.
  //
  // Was four sources; ch-jobroom left with the Job-Room adapter, retired
  // because job-room.ch's robots.txt opens "# Do not crawl Job Adverts" and
  // we had been reading it anyway. The list shrinks when a source goes — what
  // must not happen is a source deferring bodies that desc:fill cannot fetch.
  const src = readFileSync(join("scripts", "backfill", "desc-fill.ts"), "utf8");
  for (const s of ["arbeitsagentur", "manfred", "linkedin"]) {
    assert.ok(src.includes(`"${s}"`), `${s} must appear in desc-fill`);
  }
  assert.ok(!src.includes("ch-jobroom"), "a retired source must not linger in the backfill");
});
