import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnvPayload, mapHit } from "../src/lib/sources/wttj";
import { buildSearchBody, mapResult } from "../src/lib/sources/vdab";
import { mapJustJoin, mapNoFluff } from "../src/lib/sources/poland";
import { mapDoc } from "../src/lib/sources/thehub";
import { mapAgentic, mapSpeedrun } from "../src/lib/sources/nichejobs";

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
  assert.ok(job.description.includes("Kotlin"));
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
