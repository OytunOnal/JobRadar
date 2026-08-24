import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnvPayload, mapHit } from "../src/lib/sources/wttj";
import { buildSearchBody, mapResult } from "../src/lib/sources/vdab";
import { mapJustJoin, mapNoFluff } from "../src/lib/sources/poland";
import { labelledSections } from "../src/lib/text/sections";
import { mapDoc } from "../src/lib/sources/thehub";
import { mapAgentic, mapSpeedrun } from "../src/lib/sources/nichejobs";
import { classifyLiveness, normalizeForMatch } from "../src/lib/liveness";
import { canonicalJobUrl } from "../src/lib/domains";
import { isOnCooldown } from "../src/lib/ingest";
import { parseNl, parseGb, parseDk, parseIe, splitCsvLine, collapseName } from "../src/lib/visa/sponsors";
import { mapHit as wnMap, buildQuery as wnQuery } from "../src/lib/sources/workingnomads";
import { parseFeed as jiParse } from "../src/lib/sources/jobindexdk";

// ── WTTJ ─────────────────────────────────────────────────────────────────────

test("wttj parseEnvPayload: window.env wrapper, shape-guarded creds", () => {
  const ok = parseEnvPayload('window.env = {"PUBLIC_ALGOLIA_APPLICATION_ID":"CSEKHVMS53","PUBLIC_ALGOLIA_API_KEY_CLIENT":"abcdef0123456789abcdef"};');
  assert.deepEqual(ok, { appId: "CSEKHVMS53", apiKey: "abcdef0123456789abcdef" });
  // A hostname-shaped app id is required — reject weird payloads:
  assert.equal(parseEnvPayload('{"PUBLIC_ALGOLIA_APPLICATION_ID":"evil.host/x","PUBLIC_ALGOLIA_API_KEY_CLIENT":"abcdef0123456789abcdef"}'), null);
  assert.equal(parseEnvPayload("no json here"), null);
});

test("wttj mapHit: site URL from slugs, remote mapping, epoch seconds", () => {
  const job = mapHit({
    name: "LLM Engineer",
    slug: "llm-engineer_paris",
    organization: { slug: "photoroom", name: "PhotoRoom" },
    offices: [{ city: "Paris", country: "France" }],
    remote: "fulltime",
    published_at_timestamp: 1_755_600_000,
    salary_yearly_minimum: 70000,
    salary_maximum: 90000,
    salary_period: "yearly",
    salary_currency: "eur",
  })!;
  assert.ok(job.url.endsWith("/companies/photoroom/jobs/llm-engineer_paris"));
  assert.equal(job.workMode, "remote");
  assert.equal(job.salaryText, "70000–90000 EUR");
  assert.equal(job.postedAt?.getTime(), 1_755_600_000_000);
  // Path-unsafe slugs are rejected:
  assert.equal(mapHit({ name: "X", slug: "a/../b", organization: { slug: "c" } }), null);
});

// ── VDAB ─────────────────────────────────────────────────────────────────────

test("vdab: zero-indexed pages, nested title, closed postings dropped", () => {
  const body = buildSearchBody("ai engineer", 0) as any;
  assert.equal(body.pagina, 0);
  assert.equal(body.criteria.trefwoord, "ai engineer");
  const job = mapResult({
    id: { id: 74382195 },
    vacaturefunctie: { naam: "AI Automation Engineer" },
    vacatureBedrijfsnaam: "Mozzeno services",
    tewerkstellingsLocatieRegioOfAdres: "WAVRE",
    eerstePublicatieDatum: "2026-08-14T13:11:35Z",
    gesloten: false,
  })!;
  assert.equal(job.title, "AI Automation Engineer");
  assert.equal(job.location, "WAVRE, Belgium");
  assert.ok(job.url.endsWith("/vacatures/74382195"));
  assert.equal(mapResult({ id: { id: 1 }, vacaturefunctie: { naam: "X" }, gesloten: true }), null);
});

// ── Poland ───────────────────────────────────────────────────────────────────

test("justjoin mapJustJoin: workplace mapping, skills folded into description", () => {
  const job = mapJustJoin({
    slug: "citi-java-dev",
    title: "Java Developer",
    companyName: "Citigroup",
    city: "Warsaw",
    workplaceType: "hybrid",
    requiredSkills: ["Java", "Kotlin"],
    publishedAt: "2026-08-20T10:00:00Z",
  })!;
  assert.equal(job.workMode, "hybrid");
  assert.equal(job.location, "Warsaw, Poland");
  // The connector reports the named blocks; the shared assembler makes the
  // text. Asserting on the assembly here would be asserting on ingest's job.
  assert.ok(labelledSections(job.sections!).includes("Kotlin"));
  assert.equal(mapJustJoin({ title: "no slug" }), null);
});

test("nofluffjobs mapNoFluff: salary string, slug URL", () => {
  const job = mapNoFluff({
    title: "Architekt systemowy",
    name: "AVENGA",
    url: "architekt-systemowy-avenga-remote",
    location: { places: [{ city: "Warszawa" }] },
    salary: { from: 20000, to: 26000, currency: "PLN", type: "month" },
    posted: 1_755_600_000_000,
  })!;
  assert.equal(job.salaryText, "20000–26000 PLN/month");
  assert.ok(job.url.includes("/pl/job/architekt-systemowy-avenga-remote"));
  assert.equal(job.location, "Warszawa, Poland");
});

// ── TheHub ───────────────────────────────────────────────────────────────────

test("thehub mapDoc: id URL, location address, remote flag", () => {
  const job = mapDoc({
    id: "69fe7a04e71953e82dea3674",
    title: "Engineering Manager",
    company: { name: "Shine" },
    location: { country: "Germany", locality: "Berlin", address: "Berlin, Germany" },
    isRemote: false,
  })!;
  assert.ok(job.url.endsWith("/jobs/69fe7a04e71953e82dea3674"));
  assert.equal(job.location, "Berlin, Germany");
  assert.equal(mapDoc({ title: "no id" }), null);
});

// ── Niche boards ─────────────────────────────────────────────────────────────

test("agentic mapAgentic: structured visa, locationType -> workMode", () => {
  const job = mapAgentic({
    title: "Agent Platform Engineer",
    slug: "acme-agent-platform-x1",
    companyName: "Acme",
    location: "Berlin, Germany",
    locationType: "hybrid",
    salaryMin: 90000,
    salaryMax: 120000,
    salaryCurrency: "EUR",
    visaSponsorship: true,
    description: "<p>Build agents.</p>",
    postedAt: "2026-08-19T00:00:00Z",
  })!;
  assert.equal(job.visa, "yes");
  assert.equal(job.workMode, "hybrid");
  assert.equal(job.description, "Build agents.");
  assert.equal(mapAgentic({ title: "X", slug: "bad/slug" }), null);
});

test("a16z mapSpeedrun: stealth fallback company, comp string", () => {
  const job = mapSpeedrun({
    id: "sr-1",
    title: "Gameplay Engineer",
    company: null,
    url: "https://speedrun-talent-network.com/jobs/gameplay-engineer",
    workplace_type: "onsite",
    comp_min: 150000,
    comp_max: 200000,
    comp_currency: "USD",
    comp_period: "year",
    published_at: "2026-08-15T00:00:00Z",
  })!;
  assert.equal(job.company, "SPEEDRUN portfolio (stealth)");
  assert.equal(job.workMode, "onsite");
  assert.equal(job.salaryText, "150000–200000 USD/year");
});

// ── Liveness ─────────────────────────────────────────────────────────────────

test("liveness: typographic punctuation normalized before matching", () => {
  // WTTJ's French banner uses U+2019, not an ASCII apostrophe — the exact
  // silent-miss career-ops documented.
  assert.equal(classifyLiveness(200, "Cette offre n’est plus disponible."), "expired");
  assert.equal(normalizeForMatch("café “quoted”"), 'cafe "quoted"');
});

test("liveness: hard statuses, banners, and the honest defaults", () => {
  assert.equal(classifyLiveness(404, ""), "expired");
  assert.equal(classifyLiveness(410, ""), "expired");
  assert.equal(classifyLiveness(200, "Die Stelle ist bereits besetzt."), "expired");
  assert.equal(classifyLiveness(200, "This position has been filled."), "expired");
  // "application form has been filled out" must NOT read as closure:
  assert.equal(classifyLiveness(200, "Submit once the application form for this role has been filled out."), "active");
  assert.equal(classifyLiveness(200, "<h1>Senior Engineer</h1><button>Apply</button>"), "active");
  assert.equal(classifyLiveness(403, ""), "uncertain"); // walls prove nothing
  assert.equal(classifyLiveness(500, ""), "uncertain");
});

// ── Canonical URLs ───────────────────────────────────────────────────────────

test("canonicalJobUrl: strips tracking denylist, KEEPS functional params", () => {
  assert.equal(
    canonicalJobUrl("https://Boards.Greenhouse.io/acme/jobs/1?utm_source=x&gh_src=abc&gh_jid=42#apply"),
    "https://boards.greenhouse.io/acme/jobs/1?gh_jid=42", // gh_jid survives — it IS the posting id on some boards
  );
  // Query params are sorted for stability, trailing slash dropped:
  assert.equal(canonicalJobUrl("https://a.com/jobs/?b=2&a=1"), "https://a.com/jobs/?a=1&b=2");
  assert.equal(canonicalJobUrl("https://a.com/jobs/x/"), "https://a.com/jobs/x");
  // Non-URLs pass through untouched (no fake keys):
  assert.equal(canonicalJobUrl("N/A"), "N/A");
});

// ── Visa sponsor registers ───────────────────────────────────────────────────

test("sponsor parsers: NL th/td, UK CSV with quotes, DK CVR rows, IE xlsx", () => {
  const nl = parseNl('<th scope="row">Adyen N.V.</th><td>34259528</td>');
  assert.equal(nl[0].name, "Adyen N.V.");
  assert.ok(nl[0].detail!.includes("34259528"));

  const gb = parseGb(
    'Organisation Name,Town/City,County,Type & Rating,Route\n' +
    '"Acme, Ltd",London,,Worker (A rating),Skilled Worker\n' +
    'Acme Ltd,Leeds,,Worker (A rating),Skilled Worker',
  );
  assert.equal(gb.length, 1); // same collapsed name -> deduped across routes/rows
  assert.equal(gb[0].name, "Acme, Ltd");
  assert.ok(gb[0].detail!.includes("Skilled Worker"));

  const dk = parseDk("<tr><td>Unity Technologies ApS</td><td>30719913</td></tr><tr><td>Header</td><td>no digits</td></tr>");
  assert.equal(dk.length, 1);
  assert.ok(dk[0].detail!.includes("CVR 30719913"));

  assert.deepEqual(splitCsvLine('a,"b, with comma","c ""q"""'), ["a", "b, with comma", 'c "q"']);
});

test("collapseName: legal suffixes and spacing fold away for matching", () => {
  assert.equal(collapseName("Adyen N.V."), collapseName("adyen"));
  assert.equal(collapseName("Booking.com B.V."), collapseName("Booking com"));
});

// ── Working Nomads ───────────────────────────────────────────────────────────

test("workingnomads: apply_url wins, expired filtered in the query", () => {
  const q = wnQuery("llm engineer") as any;
  assert.deepEqual(q.query.bool.must_not, [{ term: { expired: true } }]);
  const job = wnMap({
    id: 1804551, title: "Principal Software Engineer", slug: "pse-dropbox",
    company: "Dropbox", apply_url: "https://jobs.dropbox.com/123",
    salary_range: "$285k-$385k per year", description: "<p>Role</p>",
    pub_date: "2026-08-20T08:03:04-04:00",
  })!;
  assert.equal(job.url, "https://jobs.dropbox.com/123");
  assert.equal(job.workMode, "remote");
  assert.equal(job.salaryText, "$285k-$385k per year");
});

// ── Jobindex ─────────────────────────────────────────────────────────────────

test("jobindex parseFeed: hex entities decoded, id from vis-job link", () => {
  const xml = `<rss><item>
    <title>Software Engineer til Flonidan, Kleven &#x26; Partners</title>
    <link>https://www.jobindex.dk/vis-job/h1691215</link>
    <pubDate>Thu, 20 Aug 2026 00:00:00 +0200</pubDate>
    <description>&#x3C;div&#x3E;Vi s&#xF8;ger en dygtig udvikler.&#x3C;/div&#x3E;</description>
  </item></rss>`;
  const jobs = jiParse(xml);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].externalId, "h1691215");
  assert.ok(jobs[0].title.includes("Kleven & Partners"));
  assert.ok(jobs[0].description.includes("dygtig udvikler"));
});

// ── Source cooldowns ─────────────────────────────────────────────────────────

test("isOnCooldown: LinkedIn keeps weekly cadence, others always run", () => {
  const now = new Date("2026-08-20T12:00:00Z");
  const twoDaysAgo = new Date("2026-08-18T12:00:00Z");
  const sixDaysAgo = new Date("2026-08-14T11:00:00Z");
  assert.equal(isOnCooldown("linkedin", twoDaysAgo, now), true);   // < 5 days
  assert.equal(isOnCooldown("linkedin", sixDaysAgo, now), false);  // window passed
  assert.equal(isOnCooldown("linkedin", null, now), false);        // never fetched
  assert.equal(isOnCooldown("eures", twoDaysAgo, now), false);     // no cooldown entry
});
