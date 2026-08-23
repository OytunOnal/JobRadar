import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchUrl,
  extractDivContent,
  mapItem,
  parseJobCards,
  parseJobDetail,
  searchPlan,
} from "../src/lib/sources/linkedin";

// ── Guest API: search plan and URL (the tiered matrix) ───────────────────────

test("searchPlan: city×onsite+hybrid, country×remote, EU×remote", () => {
  const plan = searchPlan([{ en: ["unity developer"] }], ["Berlin, Germany"], ["Turkey"]);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan[0], { keywords: "unity developer", location: "Berlin, Germany", workTypes: ["1", "3"], tier: "city" });
  assert.deepEqual(plan[1].workTypes, ["2"]);
  assert.equal(plan[2].location, "European Union");
});

test("searchPlan pairs query language with geography", () => {
  const group = {
    en: ["software engineer", "software developer"],
    de: ["softwareentwickler"],
    es: ["desarrollador de software"],
  };
  const plan = searchPlan([group], ["Berlin, Germany", "Lisbon, Portugal"], ["Spain"]);
  const q = (tier: string, location: string) =>
    plan.filter((s) => s.tier === tier && s.location === location).map((s) => s.keywords);
  // City tier: EN lead + local lead — German in Berlin, nothing extra in Lisbon
  assert.deepEqual(q("city", "Berlin, Germany"), ["software engineer", "softwareentwickler"]);
  assert.deepEqual(q("city", "Lisbon, Portugal"), ["software engineer"]);
  // Country tier adds the 2nd EN variant; Spain also gets the Spanish title
  assert.deepEqual(q("country", "Spain"), ["software engineer", "software developer", "desarrollador de software"]);
  // EU tier: EN variants only
  assert.deepEqual(q("region", "European Union"), ["software engineer", "software developer"]);
});

test("searchPlan dedupes when the local variant equals the EN lead", () => {
  const plan = searchPlan([{ en: ["product manager"], de: ["product manager"] }], ["Munich, Germany"], []);
  assert.deepEqual(plan.map((s) => s.keywords), ["product manager", "product manager"]);
  assert.equal(plan.filter((s) => s.tier === "city").length, 1);
});

test("buildSearchUrl encodes the guest-API contract", () => {
  const url = buildSearchUrl(
    { keywords: "llm engineer", location: "Berlin, Germany", workTypes: ["1", "3"], tier: "city" },
    1, // page index → start=10
    7,
  );
  assert.ok(url.startsWith("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?"));
  assert.ok(url.includes("keywords=llm+engineer"));
  assert.ok(url.includes("location=Berlin%2C+Germany"));
  assert.ok(url.includes("f_TPR=r604800")); // 7 days in seconds
  assert.ok(url.includes("f_WT=1%2C3"));
  assert.ok(url.includes("start=10"));
});

// ── Guest API: parsers, fixtures mirror live captures ────────────────────────

const CARD_HTML = `
  <li><div class="base-card base-search-card job-search-card" data-entity-urn="urn:li:jobPosting:4455766419">
    <a class="base-card__full-link ..." href="https://de.linkedin.com/jobs/view/lead-engineer-mobile-at-sixteen-tons-4455766419?position=1&amp;refId=x">
      <span class="sr-only">Lead Engineer (Mobile)</span></a>
    <div class="base-search-card__info">
      <h3 class="base-search-card__title"> Lead Engineer (Mobile) </h3>
      <h4 class="base-search-card__subtitle">
        <a class="hidden-nested-link" href="...">Sixteen Tons Entertainment</a></h4>
      <span class="job-search-card__location">Berlin, Germany</span>
      <time class="job-search-card__listdate" datetime="2026-08-18">4 hours ago</time>
    </div></div></li>
  <li><div class="base-card" data-entity-urn="urn:li:jobPosting:999">
    <h3 class="base-search-card__title">Broken card without location</h3></div></li>`;

test("parseJobCards extracts id/title/company/location/date, tolerates partial cards", () => {
  const cards = parseJobCards(CARD_HTML);
  assert.equal(cards.length, 2);
  const c = cards[0];
  assert.equal(c.id, "4455766419");
  assert.equal(c.title, "Lead Engineer (Mobile)");
  assert.equal(c.company, "Sixteen Tons Entertainment");
  assert.equal(c.location, "Berlin, Germany");
  assert.equal(c.url, "https://de.linkedin.com/jobs/view/lead-engineer-mobile-at-sixteen-tons-4455766419");
  assert.equal(c.postedAt?.toISOString().slice(0, 10), "2026-08-18");
  assert.equal(cards[1].company, ""); // partial card survives
});

test("parseJobDetail: depth-tracked div extraction survives nested divs", () => {
  const html = `<div class="core-section"><div class="show-more-less-html__markup rich">
      <p>Lead the effort.</p><div class="inner"><b>Nested</b> block</div><p>After nested.</p>
    </div></div>`;
  // Structure is preserved now (block tags become newlines): the old
  // space-flattened expectation encoded the pre-fix behaviour.
  assert.equal(parseJobDetail(html), "Lead the effort.\nNested block\nAfter nested.");
  assert.equal(parseJobDetail("<div>no markup class</div>"), "");
  assert.equal(extractDivContent("<div class='x'>unclosed", "x"), null);
});

// ── Apify fallback mapping (kept behind LINKEDIN_VIA_APIFY) ──────────────────

test("prefers the company's own apply URL over the LinkedIn wall", () => {
  const j = mapItem({
    id: 123,
    title: "Senior Unity Developer",
    company: { name: "Acme Games" },
    location: { linkedinText: "Berlin, Germany" },
    workplaceType: "Hybrid",
    linkedinUrl: "https://www.linkedin.com/jobs/view/123/",
    applyMethod: { companyApplyUrl: "https://jobs.lever.co/acmegames/uuid" },
    postedDate: "2026-08-18T10:00:00Z",
    descriptionHtml: "<p>Build <b>games</b>.</p>",
  })!;
  assert.equal(j.url, "https://jobs.lever.co/acmegames/uuid"); // harvest food
  assert.equal(j.company, "Acme Games");
  assert.equal(j.workMode, "hybrid");
  assert.equal(j.description, "Build games .");
  assert.equal(j.postedAt?.toISOString().slice(0, 10), "2026-08-18");
});

test("falls back to the LinkedIn URL and handles string company/location", () => {
  const j = mapItem({
    jobId: "456",
    title: "Dev",
    company: "Solo GmbH",
    location: "Remote",
    workplaceType: "Remote",
  })!;
  assert.equal(j.url, "https://www.linkedin.com/jobs/view/456/");
  assert.equal(j.remote, true);
  assert.equal(j.workMode, "remote");
});

test("epoch-seconds dates and junk rows", () => {
  const j = mapItem({ id: 9, title: "X", listedAt: 1787000000 })!;
  assert.equal(j.postedAt instanceof Date, true);
  assert.equal(mapItem({ id: "", title: "no id" }), null);
  assert.equal(mapItem({ id: 1 }), null); // no title
});
