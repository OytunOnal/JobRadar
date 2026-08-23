import test from "node:test";
import assert from "node:assert/strict";
import { htmlToText, looksLikeHtml } from "../src/lib/html-text";

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
