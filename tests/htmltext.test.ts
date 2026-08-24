import test from "node:test";
import assert from "node:assert/strict";
import { htmlToText, looksLikeHtml } from "../src/lib/text/html-text";

test("htmlToText: decodes BEFORE stripping — the bug that filled the pool with markup", () => {
  // Greenhouse ships HTML-encoded content. The old order (strip, then decode)
  // manifested real tags into stored text; 47-58% of a stored description was
  // markup as a result.
  const encoded = "&lt;p&gt;&lt;strong&gt;About us&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;5 years Unity&lt;/li&gt;&lt;/ul&gt;";
  const out = htmlToText(encoded);
  assert.doesNotMatch(out, /<[a-z]/i);
  assert.match(out, /About us/);
  assert.match(out, /- 5 years Unity/);
});

test("htmlToText: preserves structure — headings and bullets stay on their own lines", () => {
  const html = "<h2>Requirements</h2><ul><li>Python</li><li>Docker</li></ul><p>Nice to have: Rust</p>";
  const out = htmlToText(html);
  const lines = out.split("\n").filter(Boolean);
  assert.ok(lines.includes("Requirements"));
  assert.ok(lines.includes("- Python"));
  assert.ok(lines.includes("- Docker"));
});

test("htmlToText: drops script/style bodies and collapses only horizontal space", () => {
  const html = "<style>.x{font-size:12pt}</style><p>Real   text</p><script>var a=1</script>";
  assert.equal(htmlToText(html), "Real text");
});

test("htmlToText: plain text passes through unharmed", () => {
  assert.equal(htmlToText("We build games.\n\n- Unity\n- C#"), "We build games.\n\n- Unity\n- C#");
});

test("looksLikeHtml: flags both raw and escaped markup, ignores plain text", () => {
  assert.equal(looksLikeHtml("<p>hi</p>"), true);
  assert.equal(looksLikeHtml("&lt;p&gt;hi&lt;/p&gt;"), true);
  assert.equal(looksLikeHtml("5 < 7 and a > b"), false);
});

test("empty list items are dropped, a real dash line is kept", () => {
  // Brainlabs publishes `<li><strong>&nbsp;</strong></li>` placeholders; a
  // bare "-" bullet costs prompt tokens and makes a section look populated.
  const html = "<ul><li><strong>&nbsp;</strong></li><li>Ship features</li></ul>";
  const out = htmlToText(html);
  assert.equal(out, "- Ship features");
  // But a dash the POSTING wrote is not ours to delete.
  assert.match(htmlToText("<p>Salary band</p><p>-</p><p>Negotiable</p>"), /\n-\n/);
});

test("escaped comparison operators survive — they are text, not tags", () => {
  // Entities are decoded BEFORE tags are stripped (that is what stops
  // Greenhouse's escaped markup from reaching storage). The cost, until the
  // tag pattern required a tag-like opening, was that a posting writing
  // "&lt; 100ms" lost everything up to the next "&gt;".
  assert.equal(
    htmlToText("Latency must be &lt; 100ms and uptime &gt; 99%."),
    "Latency must be < 100ms and uptime > 99%.",
  );
  assert.equal(htmlToText("<p>We need &lt;3 years exp &gt; junior level</p>"), "We need <3 years exp > junior level");
  // Real markup must still go, escaped or not.
  assert.equal(htmlToText("<p>Hi <strong>there</strong></p>"), "Hi there");
  assert.equal(htmlToText("&lt;p&gt;Hi&lt;/p&gt;"), "Hi");
  assert.equal(htmlToText("<!-- note -->Body"), "Body");
});

test("a hostile entity cannot crash the fetch or inject anything", () => {
  // This runs inside every connector's map(), inside the source fetch: an
  // uncaught throw here made one malformed posting cost a whole source's
  // jobs for the run.
  assert.equal(htmlToText("Ref &#1234567; here"), "Ref &#1234567; here");
  assert.equal(htmlToText("Ref &#xFFFFFFF; here"), "Ref &#xFFFFFFF; here");
  assert.equal(htmlToText("Half &#xD800; pair"), "Half &#xD800; pair");
  // ENTITIES is a plain object, so it inherits Object.prototype — "&toString;"
  // used to splice a function's source into the description, and from there
  // into the embedding and the prompt.
  assert.equal(htmlToText("Ref &toString; here"), "Ref &toString; here");
  assert.equal(htmlToText("Ref &constructor; x"), "Ref &constructor; x");
  // Real references still decode.
  assert.equal(htmlToText("caf&#233; &amp; &#x2764;"), "café & ❤");
});
