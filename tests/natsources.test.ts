import { test } from "node:test";
import assert from "node:assert/strict";
import { mapJob as freehireMap, buildSearchUrl as freehireUrl } from "../src/lib/sources/freehire";
import { parseCard, cardToRawJob, buildSearchUrl as baUrl } from "../src/lib/sources/arbeitsagentur";
import { buildPayload, defaultCountries, mapJv, titlesFor } from "../src/lib/sources/eures";

// ── freehire ─────────────────────────────────────────────────────────────────

test("freehire mapJob: first-party URL, enrichment salary, work_mode", () => {
  const job = freehireMap({
    public_slug: "golang-zensar-2bxu6dxm",
    url: "https://careers.zensar.com/jobs/123",
    title: "GOLANG <b>Engineer</b>",
    company: "Zensar",
    company_slug: "zensar",
    location: "Berlin, Germany",
    work_mode: "remote",
    description: "<p>Build things in Go.</p>",
    posted_at: "2026-08-01T00:00:00Z",
    enrichment: { salary_min: 90000, salary_max: 120000, salary_currency: "EUR" },
  })!;
  assert.equal(job.source, "freehire");
  assert.equal(job.url, "https://careers.zensar.com/jobs/123"); // ATS host, not freehire
  assert.equal(job.title, "GOLANG Engineer");
  assert.equal(job.workMode, "remote");
  assert.equal(job.remote, true);
  assert.equal(job.salaryText, "90000–120000 EUR");
  assert.equal(job.description, "Build things in Go.");
  // Junk guards:
  assert.equal(freehireMap({ title: "no slug/url" }), null);
});

test("freehire search URL: country pass ORs countries, remote pass uses eu region", () => {
  const u = new URL(freehireUrl("llm engineer"));
  assert.equal(u.searchParams.get("q"), "llm engineer");
  assert.equal(u.searchParams.get("include_description"), "true");
  assert.ok(u.searchParams.getAll("countries").includes("de"));
  const r = new URL(freehireUrl("llm engineer", { remote: true }));
  assert.equal(r.searchParams.get("work_mode"), "remote");
  assert.deepEqual(r.searchParams.getAll("regions"), ["eu"]);
  assert.deepEqual(r.searchParams.getAll("countries"), []);
});

// ── arbeitsagentur ───────────────────────────────────────────────────────────

test("BA parseCard: live-verified v6 shape → card", () => {
  const card = parseCard({
    stellenangebotsTitel: "Software Engineer (m/w/d)",
    firma: "Industrie- und Handelskammer zu Berlin",
    referenznummer: "18988-ppcC5vH9-S",
    stellenlokationen: [{ adresse: { ort: "Berlin", land: "DEUTSCHLAND" } }],
    gehaltsspanneVon: 65000.0,
    gehaltsspanneBis: 69000.0,
    datumErsteVeroeffentlichung: "2026-07-29",
  })!;
  assert.equal(card.refnr, "18988-ppcC5vH9-S");
  assert.equal(card.location, "Berlin, Germany");
  assert.equal(card.salaryText, "65000–69000 EUR");
  assert.equal(parseCard({ firma: "no title/refnr" }), null);
});

test("BA cardToRawJob: employer URL wins over the BA detail page", () => {
  const card = parseCard({
    stellenangebotsTitel: "Unity Developer",
    firma: "Acme",
    referenznummer: "10001-X",
    stellenlokationen: [{ adresse: { ort: "München", land: "DEUTSCHLAND" } }],
  })!;
  const bare = cardToRawJob(card);
  assert.ok(bare.url.startsWith("https://www.arbeitsagentur.de/jobsuche/jobdetail/"));
  const withDetail = cardToRawJob(card, {
    description: "Wir suchen…",
    externalUrl: "https://acme.de/jobs/42",
  });
  assert.equal(withDetail.url, "https://acme.de/jobs/42");
  assert.equal(withDetail.description, "Wir suchen…");
  assert.ok(baUrl("softwareentwickler").includes("was=softwareentwickler"));
});

// ── eures ────────────────────────────────────────────────────────────────────

test("EURES payload: multi-word titles split into ANDed TITLE keywords", () => {
  const p = buildPayload("software engineer", "nl") as any;
  assert.deepEqual(p.keywords, [
    { keyword: "software", specificSearchCode: "TITLE" },
    { keyword: "engineer", specificSearchCode: "TITLE" },
  ]);
  assert.deepEqual(p.locationCodes, ["nl"]);
  assert.equal(p.publicationPeriod, "LAST_WEEK");
});

test("EURES titlesFor pairs local language with country", () => {
  const group = { en: ["software engineer"], es: ["desarrollador de software"], nl: ["software ontwikkelaar"] };
  assert.deepEqual(titlesFor(group, "es"), ["software engineer", "desarrollador de software"]);
  assert.deepEqual(titlesFor(group, "pt"), ["software engineer"]); // group has no pt variant → EN only
});

test("EURES mapJv: portal detail URL, epoch dates, HTML stripped", () => {
  const job = mapJv({
    id: "NTdhNDEwMDUtMWIyZC05NzM3 42",
    title: "Service Software Engineer",
    description: "<br>Met je kennis<br>",
    creationDate: 1785201200980,
    employer: { name: "Sovon" },
    locationMap: { NL: ["NL226"] },
  }, "nl")!;
  assert.equal(job.company, "Sovon");
  assert.equal(job.location, "Netherlands");
  assert.ok(job.url.includes("/jv-details/NTdhNDEwMDUtMWIyZC05NzM3%2042"));
  assert.equal(job.description, "Met je kennis");
  assert.equal(job.postedAt?.getTime(), 1785201200980);
  assert.equal(mapJv({ title: "no id" }, "nl"), null);
});

test("EURES default sweep covers every member country", () => {
  const c = defaultCountries();
  for (const must of ["de", "nl", "es", "pt", "fr", "pl", "at", "no", "is", "ch"]) {
    assert.ok(c.includes(must), `missing ${must}`);
  }
  assert.ok(c.length >= 29);
  assert.ok(!c.includes("gb")); // the UK left EURES post-Brexit
});
