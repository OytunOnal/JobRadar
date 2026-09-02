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

// ── Manatal (careers-page.com) ───────────────────────────────────────────────

test("manatal: hash id, slug URL, HTML body stripped, agency location fallbacks", async () => {
  const { mapManatalJob } = await import("../src/lib/sources/ats/manatal");
  const job = mapManatalJob({
    id: 4247112,
    hash: "RY963356",
    position_name: "Medical Information Specialist",
    description: "<p><b>Job Title:</b> Specialist</p><p>Remote role.</p>",
    country: "", state: "", city: "",
    address: "London",
    location_display: "",
  }, "lifelancer", "Lifelancer")!;
  assert.equal(job.source, "manatal:lifelancer");
  assert.equal(job.externalId, "RY963356");
  assert.ok(job.url.endsWith("/lifelancer/job/RY963356"));
  assert.equal(job.location, "London", "location_display empty, city empty -> address");
  assert.ok(!job.description.includes("<"), "HTML stripped");
  // The body says "Remote role." and the flag stays false on purpose:
  // remote is read from location+title only. Guessing it from description
  // prose is exactly what the work-mode measurement buried.
  assert.equal(job.remote, false);
});

// ── Hunt UK Visa Sponsors ────────────────────────────────────────────────────

test("huntuk: cards parse into role/company/rating, title metadata is split out", async () => {
  const { parseHuntUkList, mapHuntUkCard } = await import("../src/lib/sources/huntukvisasponsors");
  const html = `
    <a class="x" href="/job/senior-dev-london-at-acme-abc123"><div>
      <img alt="ACME TRADING LIMITED" src="x.jpg"/>
      <span class="truncate text-[13.5px] font-medium">Senior Dev | London, hybrid | up to £90k</span>
      <span title="Sponsorship likely. This sponsor issues visas.">likely</span>
    </div></a>
    <a class="x" href="/job/nurse-at-nhs-def456"><div>
      <img alt="NHS FOUNDATION TRUST" src="y.jpg"/>
      <span class="truncate text-[13.5px] font-medium">Staff Nurse</span>
      <span title="Sponsorship unlikely. Little sign.">unlikely</span>
    </div></a>
    <a rel="next" href="https://huntukvisasponsors.com/jobs?after=abc"/>`;
  const { cards, nextUrl } = parseHuntUkList(html);
  assert.equal(cards.length, 2);
  assert.equal(nextUrl, "https://huntukvisasponsors.com/jobs?after=abc");
  const job = mapHuntUkCard(cards[0]!);
  assert.equal(job.title, "Senior Dev", "the site's pipe metadata is not the employer's title");
  assert.equal(job.company, "ACME TRADING LIMITED", "legal register name, for the sponsorReg match");
  assert.equal(job.location, "London, United Kingdom");
  assert.equal(job.salaryText, "up to £90k");
  assert.match(job.description, /Sponsorship likely/, "the rating travels as text, never as structured visa");
  const nurse = mapHuntUkCard(cards[1]!);
  assert.equal(nurse.title, "Staff Nurse");
  assert.equal(nurse.location, "United Kingdom");
  assert.match(nurse.description, /Sponsorship unlikely/);
});
