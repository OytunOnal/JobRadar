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

test("nofluffjobs mapNoFluff: country from the catalog, not a hardcoded Poland", () => {
  // The full catalog spans six countries; the windowed-era mapper stamped
  // ", Poland" onto all of them.
  const hu = mapNoFluff({
    title: "Backend Engineer",
    name: "Acme",
    url: "backend-engineer-acme-budapest",
    location: { places: [{ city: "Budapest", country: { code: "HUN", name: "Hungary" } }] },
  })!;
  assert.equal(hu.location, "Budapest, Hungary");
  assert.equal(hu.workMode, undefined, "not remote: the flag's resting state stays silent");
});

test("nofluffjobs mapNoFluff: a hidden salary stays hidden", () => {
  const job = mapNoFluff({
    title: "Dev", name: "X", url: "dev-x",
    salary: { from: 100, to: 200, currency: "PLN", disclosedAt: "HIDDEN" },
  })!;
  assert.equal(job.salaryText, undefined);
});

test("nofluffjobs mapNoFluff: salary string, slug URL", () => {
  const job = mapNoFluff({
    title: "Architekt systemowy",
    name: "AVENGA",
    url: "architekt-systemowy-avenga-remote",
    location: { places: [{ city: "Warszawa", country: { code: "POL", name: "Poland" } }] },
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

test("liveness: a banner may name the thing with two words, not one", () => {
  // Arbeitnow: "This job position has been removed from Arbeitnow". The pattern
  // allowed exactly one noun between "this" and "has", so a genuinely closed
  // posting read as ACTIVE — measured against the live page, which is how it
  // was found rather than by reading the regex.
  const arbeitnow =
    "Post a Job Jobs in Germany This job position has been removed from Arbeitnow and might not be hiring still.";
  assert.equal(classifyLiveness(200, arbeitnow), "expired");
  assert.equal(classifyLiveness(200, "This job has been removed"), "expired");
  assert.equal(classifyLiveness(200, "This job listing has expired"), "expired");
  assert.equal(classifyLiveness(200, "This job posting has been taken down"), "expired");
  // And a page that says the opposite still reads as open.
  assert.equal(classifyLiveness(200, "We are still hiring for this position"), "active");
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

// ── IE permits register: counts survive the parse ────────────────────────────

test("parseIe reads permit counts and the latest month, not just names", async () => {
  const { zipSync, strToU8 } = await import("fflate");
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
    <row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>3</v></c><c r="D2"><v>3</v></c></row>
    <row r="3"><c r="A3" t="s"><v>5</v></c><c r="C3"><v>1</v></c><c r="D3"><v>1</v></c></row>
    <row r="4"><c r="A4"><v>9999</v></c><c r="D4"><v>4</v></c></row>
  </sheetData></worksheet>`;
  const shared = `<?xml version="1.0"?><sst>
    <si><t>Employer Name</t></si><si><t>Permits Issued Jan</t></si>
    <si><t>Permits Issued Feb</t></si><si><t>Permits Issued Grand Total</t></si>
    <si><t>Acme Clinical Ltd</t></si><si><t>Beta Robotics</t></si></sst>`;
  const xlsx = zipSync({
    "xl/worksheets/sheet1.xml": strToU8(sheet),
    "xl/sharedStrings.xml": strToU8(shared),
  });
  const rows = parseIe(xlsx);
  assert.equal(rows.length, 2, "the numeric-A footer row is not an employer");
  assert.equal(rows[0].name, "Acme Clinical Ltd");
  assert.equal(rows[0].detail, "IE permits issued this year: 3 (latest Jan)");
  assert.equal(rows[1].detail, "IE permits issued this year: 1 (latest Feb)",
    "grand total column wins; latest month is the last one with a count");
});

test("parsePtRows keeps only the certifications that are live today", async () => {
  // Portugal is the only register whose rows EXPIRE, so the rule that drops
  // lapsed ones is the part worth pinning: it separates "certified today"
  // from "was certified once", and only the first is a sponsorship signal.
  const { parsePtRows } = await import("../src/lib/visa/sponsors");
  // The shape unpdf extracts: NIF, name, certified-from, certified-to.
  const text = [
    "509856462 2WINDSERVICE, LDA 06-12-2021 06-12-2026",
    "515755370 ABP IMPEX UNIPESSOAL, LDA 29-09-2020 29-09-2025",
    "510688268 A2ITwb - Tecnologia, S.A. 09-01-2023 09-01-2028",
    "510688268 A2ITwb - Tecnologia, S.A. 09-01-2023 09-01-2028",
  ].join(" ");

  const rows = parsePtRows(text, new Date("2026-09-04"));
  assert.deepEqual(rows.map((r) => r.name), ["2WINDSERVICE, LDA", "A2ITwb - Tecnologia, S.A."],
    "the 2025 expiry is dropped, and the repeated row collapses");
  assert.equal(rows[0]!.detail, "PT Tech Visa certified until 06-12-2026 (NIF 509856462)");

  // Roll the clock past the first expiry and it must retire on its own — the
  // property that lets a frozen file drain instead of going stale in silence.
  assert.deepEqual(parsePtRows(text, new Date("2027-01-01")).map((r) => r.name),
    ["A2ITwb - Tecnologia, S.A."]);
  assert.deepEqual(parsePtRows(text, new Date("2030-01-01")), []);
});

test("parseCzEmployers keeps the visa-flagged employers and remembers which route", async () => {
  // The Czech feed is a vacancy register, not a licence list: we reduce it to
  // the employers who declared at least one vacancy open to a non-EU national.
  const { parseCzEmployers } = await import("../src/lib/visa/sponsors");
  const feed = {
    polozky: [
      { zamestnaneckaKarta: true, zamestnavatel: { nazev: "Alza.cz a.s.", ico: "27082440" } },
      { zamestnaneckaKarta: true, zamestnavatel: { nazev: "Alza.cz a.s.", ico: "27082440" } },
      { modraKarta: true, zamestnaneckaKarta: true, zamestnavatel: { nazev: "SAP Services s.r.o.", ico: "27164297" } },
      { zamestnaneckaKarta: false, modraKarta: false, zamestnavatel: { nazev: "Not Hiring Foreigners s.r.o.", ico: "111" } },
      { zamestnaneckaKarta: true, zamestnavatel: { nazev: "" } },
    ],
  };
  const rows = parseCzEmployers(feed);
  assert.deepEqual(rows.map((r) => r.name).sort(), ["Alza.cz a.s.", "SAP Services s.r.o."],
    "an unflagged employer is not a sponsor, and a nameless row is not a company");
  // The Blue Card route is the skilled one; flattening it into "sponsor" would
  // lose the distinction that matters most to this radar's user.
  assert.match(rows.find((r) => r.name.startsWith("SAP"))!.detail!, /EU Blue Card/);
  assert.match(rows.find((r) => r.name.startsWith("Alza"))!.detail!, /employee card/);
  assert.match(rows[0]!.detail!, /IČO \d+/);
});

test("every sponsor register is in the probe priority list, best-hit-rate first", async () => {
  // A seventh register added to REGISTER_COUNTRIES but forgotten here would be
  // ingested and then never probed — its names would sit in VisaSponsor while
  // the lane drained the six it knows about. Two lists that must agree.
  const { REGISTER_COUNTRIES } = await import("../src/lib/visa/sponsors");
  const { REGISTER_ORDER } = await import("../src/lib/discovery/nameprobe");
  assert.deepEqual([...REGISTER_COUNTRIES].sort(), [...REGISTER_ORDER].sort(),
    "REGISTER_ORDER must name exactly the registers we ingest");

  // Order is ranked by how likely a name is to HAVE an ATS board, which is not
  // the same axis as sponsorship strength — the first version ranked Czechia
  // first for having the strongest sponsorship signal and then probed 200
  // Czech village firms for zero hits. NL's kennismigrant list measured 3.8%.
  assert.equal(REGISTER_ORDER[0], "nl", "the measured-best register leads");
  assert.equal(REGISTER_ORDER.at(-1), "gb", "126,493 licensed sponsors, mostly not tech, last");
  assert.ok(REGISTER_ORDER.indexOf("cz") > REGISTER_ORDER.indexOf("nl"),
    "Czechia's bulk trails NL: strong sponsors, few ATS boards");
});

test("the validation queue round-robins across platforms", async () => {
  // Boards are discovered in bulk, so the table clusters by platform: a real
  // queue opened teamtailor, breezy, teamtailor, then 117 consecutive Workable
  // boards out of 907. At concurrency 10 that is ten simultaneous requests to
  // one host — the shape that earned a 429 with a fourteen-hour retry-after.
  const { interleaveByPlatform } = await import("../src/lib/discovery/validate");
  const clustered = [
    { platform: "teamtailor", id: 1 },
    { platform: "breezy", id: 2 },
    ...Array.from({ length: 6 }, (_, i) => ({ platform: "workable", id: 10 + i })),
  ];
  const spread = interleaveByPlatform(clustered);
  assert.equal(spread.length, clustered.length, "nothing is dropped");
  // No two consecutive entries share a platform while another lane still has
  // work — the burst only reappears once the shorter lanes are exhausted.
  assert.deepEqual(spread.slice(0, 3).map((b) => b.platform), ["teamtailor", "breezy", "workable"]);
  // Order WITHIN a platform is preserved, so the id-ascending walk still makes
  // monotonic progress through each lane.
  assert.deepEqual(spread.filter((b) => b.platform === "workable").map((b) => b.id), [10, 11, 12, 13, 14, 15]);
  assert.deepEqual(interleaveByPlatform([]), []);
});

test("a platform standing down is dropped from the queue, not probed and counted", async () => {
  const { interleaveByPlatform } = await import("../src/lib/discovery/validate");
  // The shape the fix relies on: with the blocked platform filtered out
  // BEFORE interleaving, the remaining lanes still round-robin normally and
  // the run's budget goes to hosts that will answer. Measured mid-throttle,
  // the alternative was 120 boards "checked" in one second for 119 errors.
  const boards = [
    { platform: "workable", id: 1 },
    { platform: "workable", id: 2 },
    { platform: "greenhouse", id: 3 },
    { platform: "ashby", id: 4 },
  ];
  const standingDown = new Set(["workable"]);
  const probeable = boards.filter((b) => !standingDown.has(b.platform));
  assert.equal(probeable.length, 2, "the blocked platform's boards are left for next run");
  assert.deepEqual(interleaveByPlatform(probeable).map((b) => b.platform), ["greenhouse", "ashby"]);
});

test("the host gate is one budget per host, whoever asks", async () => {
  const { withHost, hostKey, resetHostGate, hostInFlightCap } = await import("../src/lib/net/hostgate");
  resetHostGate();
  // Tenant subdomains and the platform's own API are one operator, so they
  // share a budget: this is what stops name-probe and validation from each
  // spending a full allowance on greenhouse at the same time.
  assert.equal(hostKey("https://acme.recruitee.com/api/offers"), "recruitee.com");
  assert.equal(hostKey("https://boards-api.greenhouse.io/v1/x"), "greenhouse.io");
  // Two-part public suffixes keep three labels, or every .co.uk site would
  // share one budget with every other.
  assert.equal(hostKey("https://jobs.example.co.uk/x"), "example.co.uk");

  let peak = 0, live = 0;
  const task = () => withHost("https://one.example.com/x", async () => {
    live++; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 30));
    live--;
  });
  // Many callers, one host: the gate holds concurrency at the cap regardless
  // of how many lanes ask. Asserted against the cap itself — an earlier
  // version hardcoded 2 and failed the day the cap was tuned, which pinned
  // the number instead of the behaviour.
  const cap = hostInFlightCap();
  await Promise.all(Array.from({ length: cap * 5 }, task));
  assert.ok(peak <= cap, `host saw ${peak} at once, cap is ${cap}`);
  assert.ok(peak > 1, "and it does use the allowance, not just respect it");
  assert.equal(live, 0, "every slot is released, including on the error path");

  // A throwing body must not leak its slot — otherwise one bad host silently
  // shrinks its own budget to zero for the rest of the run.
  await assert.rejects(withHost("https://two.example.com/x", async () => { throw new Error("boom"); }));
  await withHost("https://two.example.com/x", async () => "fine");
  resetHostGate();
});

test("the gate reports queueing separately from work", async () => {
  const { withHost, hostStats, resetHostGate } = await import("../src/lib/net/hostgate");
  resetHostGate();
  // Six callers, one host, cap of two: four have to queue. Once lanes run
  // concurrently a stage's elapsed clock includes time spent waiting behind
  // ANOTHER lane, so "slow" and "starved" look identical without this split.
  await Promise.all(Array.from({ length: 6 }, () =>
    withHost("https://x.example.com/a", () => new Promise((r) => setTimeout(r, 60)))));
  const [stat] = hostStats();
  assert.equal(stat!.host, "example.com");
  assert.equal(stat!.requests, 6);
  assert.ok(stat!.waitMs > stat!.busyMs / 2,
    `queueing should dominate here: wait ${stat!.waitMs} vs busy ${stat!.busyMs}`);
  // An uncontended host records requests and effectively no queue time.
  await withHost("https://solo.example.org/a", async () => "ok");
  const solo = hostStats().find((h) => h.host === "example.org")!;
  assert.equal(solo.requests, 1);
  assert.ok(solo.waitMs < 50, `uncontended host should not report queueing, got ${solo.waitMs}`);
  resetHostGate();
});

test("worker counts are derived from the host budget, not chosen", async () => {
  const { workersForHosts, hostInFlightCap } = await import("../src/lib/net/hostgate");
  // Enough workers to spend every host's allowance: hosts x per-host cap.
  // The inherited default of ten under-served a nine-host queue and
  // over-served a one-host queue, in the same run. Expressed against the cap
  // so tuning it does not break the rule this test exists to state.
  const cap = hostInFlightCap();
  assert.equal(workersForHosts(1), cap);
  assert.equal(workersForHosts(3), 3 * cap);
  // A queue with no distinct hosts still gets a worker, or it never drains.
  assert.equal(workersForHosts(0), 1);
  // Bounded: a hundred hosts does not justify two hundred workers on one box.
  assert.equal(workersForHosts(100), 24);
  assert.equal(workersForHosts(100, 8), 8);
});

test("the pump backs off on SYSTEM memory, not only its own heap", async () => {
  const { pump } = await import("../src/lib/ingest/fetch");
  // Measured on the real machine mid-run: process heap 4MB, system free
  // 0.97GB of 32GB. A control that watches only its own heap reports calm
  // while the box is one allocation from swapping — Ollama holds an 18.5GB
  // model resident, and the pressure is real even though it is not ours.
  const sources = Array.from({ length: 6 }, (_, i) => ({ name: `s${i}`, fetch: async () => [] })) as any;
  let peak = 0, live = 0;
  const work = async () => {
    live++; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 20));
    live--;
  };
  await pump(sources, work, {
    concurrency: 6,
    heapMB: () => 4,            // our heap is fine
    sysFreeMB: () => 300,       // the machine is not
  });
  assert.equal(peak, 1, `critical system memory must collapse to one, saw ${peak}`);

  peak = 0;
  await pump(sources, work, { concurrency: 6, heapMB: () => 4, sysFreeMB: () => 32_000 });
  assert.ok(peak > 1, "a healthy machine keeps the caller's concurrency");
});
