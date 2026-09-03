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

// ── NAV Norway feed ──────────────────────────────────────────────────────────

test("nav-no: token is extracted from prose, items map, non-ACTIVE is skipped", async () => {
  const { extractToken, mapFeedItem } = await import("../src/lib/sources/navno");
  assert.ok(extractToken("Current public token for Nav Job Vacancy Feed:\neyJhbGc.abc-123.x_Y")?.startsWith("eyJ"));
  assert.equal(extractToken("no jwt here"), null);
  const job = mapFeedItem({
    id: "e53bed6a", url: "/api/v1/feedentry/e53bed6a",
    title: "outer title", date_modified: "2026-09-03T09:13:00+02:00",
    _feed_entry: { uuid: "cd4c93ba", status: "ACTIVE", title: "Operasjonssykepleier", businessName: "Bærum sykehus", municipal: "NORDRE FOLLO" },
  })!;
  assert.equal(job.source, "nav-no");
  assert.equal(job.externalId, "cd4c93ba");
  assert.equal(job.location, "Nordre follo, Norway", "SHOUTED municipal is folded to a name");
  assert.ok(job.url.includes("arbeidsplassen.nav.no/stillinger/stilling/cd4c93ba"));
  assert.equal(mapFeedItem({ _feed_entry: { uuid: "x", status: "INACTIVE", title: "Gone" } }), null,
    "an inactive entry is not a sighting");
});

// ── Ergodotisi (Cyprus): title shape and paragraph body ──────────────────────

test("ergodotisi: the board suffix goes, the FIRST ' at ' splits role from company", async () => {
  const { parseErgodotisiTitle, extractParagraphBody } = await import("../src/lib/sources/ergodotisi");
  const a = parseErgodotisiTitle("Store Manager at The Biscuit Corner - MyCookieDough | Ergodotisi")!;
  assert.equal(a.title, "Store Manager");
  assert.equal(a.company, "The Biscuit Corner - MyCookieDough");
  // A company name may itself contain " at "; splitting on the FIRST one keeps
  // the role whole, which is the field the scorer reads.
  const b = parseErgodotisiTitle("Barista at Coffee at Home Ltd | Ergodotisi")!;
  assert.equal(b.title, "Barista");
  assert.equal(b.company, "Coffee at Home Ltd");
  assert.equal(parseErgodotisiTitle(" | Ergodotisi"), null);

  // Nav and chrome do not write long paragraphs; the length gate is what
  // separates the ad from the furniture without pinning a class name.
  const html = `<p class="nav">Jobs</p><p>${"x".repeat(60)}</p><p>short</p>`;
  assert.equal(extractParagraphBody(html), "x".repeat(60));
});

// ── jobs.ch: not everything wearing JobPosting markup is a job ───────────────

test("jobs-ch: marketing pages borrowing the schema are refused", async () => {
  const { mapJobsChLd } = await import("../src/lib/sources/jobsch");
  const url = "https://www.jobs.ch/en/vacancies/detail/fe9f7fa0-114b-4e7d-b6ab-791a2ec35e64/";
  const real = mapJobsChLd(url, {
    title: "Civil Engineer",
    hiringOrganization: { name: "Schnetzer Puskas Ingenieure AG" },
    jobLocation: { address: { addressLocality: "Zürich" } },
    datePosted: "2025-10-28T10:08:56+01:00",
    description: "x".repeat(1900),
  })!;
  assert.equal(real.externalId, "fe9f7fa0-114b-4e7d-b6ab-791a2ec35e64", "the UUID is the cross-language identity");
  assert.equal(real.location, "Zürich, Switzerland");

  // Both guards, each from a real first-run miss: a site-furniture pipe in the
  // title, and a body too short to be an advert.
  assert.equal(mapJobsChLd(url, {
    title: "Download Brochures and Price Lists | SIBIRGroup",
    hiringOrganization: { name: "SIBIRGroup AG" },
    description: "x".repeat(1900),
  }), null);
  assert.equal(mapJobsChLd(url, {
    title: "Crew",
    hiringOrganization: { name: "McDonald's" },
    description: "too short to be an advert",
  }), null);
});

// ── The CEE batch: three quirks that each hid a whole board ──────────────────

test("jsonld: control characters inside strings are escaped, not stripped", async () => {
  const { escapeControlsInStrings, extractJobPostingLd } = await import("../src/lib/sources/jsonld");
  // Optius ships literal newlines inside a string value. Invalid JSON, and it
  // made the only JobPosting block on the page unparseable — the whole
  // Slovenian board looked structure-less because of it.
  const broken = '{"a":"line one\nline two","b":\n  "fine"}';
  assert.throws(() => JSON.parse(broken));
  const fixed = JSON.parse(escapeControlsInStrings(broken));
  assert.equal(fixed.a, "line one\nline two", "the value survives, newline and all");
  assert.equal(fixed.b, "fine", "whitespace BETWEEN tokens is untouched");
  // A backslash-escaped quote must not flip the in-string state.
  assert.equal(JSON.parse(escapeControlsInStrings('{"q":"a \\" b\tc"}')).q, 'a " b\tc');

  const html = `<script type="application/ld+json">{"@type":"JobPosting","title":"X\nY","hiringOrganization":{"name":"Acme"}}</script>`;
  assert.equal(extractJobPostingLd(html)?.hiringOrganization?.name, "Acme");
});

test("ldboards: the employer is taken from whichever field is not a URL", async () => {
  const { mapLdPosting } = await import("../src/lib/sources/ldboards");
  const board = { name: "dev-bg", sitemap: "", jobPath: /x/, country: "Bulgaria", max: 1 };
  // dev.bg fills the schema backwards: name holds the URL, sameAs the name.
  const inverted = mapLdPosting(board, "https://dev.bg/company/jobads/kirey-abc", {
    title: "Engineer",
    hiringOrganization: { name: "https://dev.bg/company/kirey/", sameAs: "Kirey" },
    description: "x".repeat(200),
  })!;
  assert.equal(inverted.company, "Kirey");
  // The ordinary shape still wins on `name`.
  assert.equal(mapLdPosting(board, "https://dev.bg/company/jobads/acme-x", {
    title: "Engineer", hiringOrganization: { name: "Acme", sameAs: "https://acme.example" }, description: "y",
  })!.company, "Acme");
  // No usable name anywhere is a dropped row, never a "?" company: company is
  // half the dedupe key and the join to the sponsor registers.
  assert.equal(mapLdPosting({ ...board, name: "x" }, "https://example.com/j/1", {
    title: "Engineer", hiringOrganization: { "@id": "https://example.com/#/org/9" },
  }), null);
});
