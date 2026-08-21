import test from "node:test";
import assert from "node:assert/strict";
import { mapGreenjobsEntry } from "../src/lib/sources/greenjobsde";
import { parseFeed, splitCompany } from "../src/lib/sources/rssfeeds";
import { mapMuseJob, mapDuunitoriJob, mapWarpJob } from "../src/lib/sources/apiboards";
import { mapGermanTechJob } from "../src/lib/sources/germantechjobs";
test("greenjobsde: atom entry parses title/location/company; gender marker is not a location", () => {
  const entry = `<title>CAD-Konstrukteur (m/w/d) (Meißen / bundesweit) - UKA Umweltgerechte Kraftanlagen GmbH &amp; Co. KG</title>` +
    `<link href="https://www.greenjobs.de/angebote/index.html?id=100154571&amp;anz=html" />` +
    `<updated>2026-08-21T14:18:11+02:00</updated>`;
  const j = mapGreenjobsEntry(entry)!;
  assert.equal(j.externalId, "100154571");
  assert.equal(j.title, "CAD-Konstrukteur (m/w/d)");
  assert.equal(j.location, "Meißen / bundesweit");
  assert.match(j.company, /^UKA Umweltgerechte/);
  // A title whose ONLY parenthetical is the gender marker keeps it, no location
  const j2 = mapGreenjobsEntry(`<title>Entwickler (m/w/d) - ACME GmbH</title><link href="https://x.de/?id=5" /><updated>2026-08-21T00:00:00+02:00</updated>`)!;
  assert.equal(j2.title, "Entwickler (m/w/d)");
  assert.equal(j2.location, "");
});

test("rssfeeds: RSS item with CDATA and 'at' company splits cleanly", () => {
  const def = { id: "x", label: "Board X", url: "http://x", company: "at" as const };
  const xml = `<rss><channel><item><title><![CDATA[Senior LLM Engineer at Acme AI]]></title>` +
    `<link>https://x.example/jobs/42?utm=rss&amp;a=1</link>` +
    `<pubDate>Fri, 21 Aug 2026 10:00:00 GMT</pubDate>` +
    `<description><![CDATA[<p>Build agents.</p>]]></description></item></channel></rss>`;
  const [j] = parseFeed(xml, def);
  assert.equal(j.title, "Senior LLM Engineer");
  assert.equal(j.company, "Acme AI");
  assert.equal(j.url, "https://x.example/jobs/42?utm=rss&a=1");
  assert.equal(j.description, "Build agents.");
  assert.ok(j.postedAt instanceof Date);
});

test("rssfeeds: Atom entry with href link and remoteDefault", () => {
  const def = { id: "x", label: "Board X", url: "http://x", remoteDefault: true };
  const xml = `<feed><entry><title>Backend Developer</title>` +
    `<link rel="alternate" href="https://x.example/j/7"/>` +
    `<updated>2026-08-21T10:00:00Z</updated><summary>Go role</summary></entry></feed>`;
  const [j] = parseFeed(xml, def);
  assert.equal(j.url, "https://x.example/j/7");
  assert.equal(j.remote, true);
  assert.equal(j.company, "Board X"); // no company signal -> board label
});

test("rssfeeds: dash company strategy refuses job-word tails", () => {
  const def = { id: "x", label: "B", url: "http://x", company: "dash" as const };
  assert.equal(splitCompany("Fachplaner Windenergie - UKA GmbH", def).company, "UKA GmbH");
  // "- Senior Engineer" is part of the title, not a company
  assert.equal(splitCompany("Platform Team - Senior Engineer", def).company, "");
});

test("apiboards: muse/germantech/duunitori/warp mappers", () => {
  const m = mapMuseJob({ id: 5, name: "SWE", company: { name: "SpaceX" }, locations: [{ name: "Berlin, Germany" }], contents: "<b>x</b>", publication_date: "2026-08-01", refs: { landing_page: "https://muse/j/5" } })!;
  assert.equal(m.company, "SpaceX");
  assert.equal(m.location, "Berlin, Germany");
  const g = mapGermanTechJob({ _id: "a", name: "Dev", company: "ACME", actualCity: "Köln", hasVisaSponsorship: "Yes", redirectJobUrl: "https://a" })!;
  assert.equal(g.visa, "yes");
  assert.equal(g.location, "Köln, Germany");
  const d = mapDuunitoriJob({ slug: "acme-dev-123", heading: "Kehittäjä", company_name: "Acme Oy", date_posted: "2026-08-21" })!;
  assert.equal(d.externalId, "acme-dev-123");
  assert.ok(d.url.endsWith("/acme-dev-123"));
  const w = mapWarpJob({ title: "Inference Eng", url: "https://w/1", company: "Together", visa_sponsor: true })!;
  assert.equal(w.visa, "yes");
});
