import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchUrl as seUrl, mapHit } from "../src/lib/sources/sweden";
import { buildSearchUrl as dkUrl, mapAd } from "../src/lib/sources/denmark";
import { parseAd, cardToRawJob } from "../src/lib/sources/switzerland";

// ── Sweden (JobTech) ─────────────────────────────────────────────────────────

test("sweden mapHit: employer channel beats Platsbanken page, live-verified shape", () => {
  const job = mapHit({
    id: "31375817",
    headline: "Software Engineer",
    employer: { name: "Ingrid Capacity AB" },
    workplace_address: { municipality: "Stockholm" },
    description: { text: "Build things.\n\nMore text." },
    publication_date: "2026-08-20T10:43:40",
    webpage_url: "https://arbetsformedlingen.se/platsbanken/annonser/31375817",
    application_details: { url: "https://ingrid.se/careers/1" },
  })!;
  assert.equal(job.source, "sweden-jobtech");
  assert.equal(job.url, "https://ingrid.se/careers/1");
  assert.equal(job.location, "Stockholm, Sweden");
  assert.ok(job.postedAt!.getFullYear() >= 2026);
  // Without the employer channel the Platsbanken page serves:
  const fallback = mapHit({ id: "1", headline: "X", webpage_url: "https://af.se/1" })!;
  assert.equal(fallback.url, "https://af.se/1");
  assert.equal(mapHit({ headline: "no id" }), null);
});

test("sweden search URL: server-side window + offset paging", () => {
  const u = new URL(seUrl("llm engineer", 2, "2026-08-13T00:00:00"));
  assert.equal(u.searchParams.get("offset"), "200");
  assert.equal(u.searchParams.get("published-after"), "2026-08-13T00:00:00");
});

// ── Denmark (Jobnet) ─────────────────────────────────────────────────────────

test("denmark mapAd: full description in search results, jobnet detail URL", () => {
  const job = mapAd({
    jobAdId: "5322e3f6-88dc-4089-b420-04e7582b51f0",
    title: "Software Engineer",
    hiringOrgName: "Candeno A/S",
    postalDistrictName: "København",
    publicationDate: "2026-08-20T00:00:00+02:00",
    description: "<p>Vi søger…</p>",
  })!;
  assert.equal(job.url, "https://jobnet.dk/find-job/5322e3f6-88dc-4089-b420-04e7582b51f0");
  assert.equal(job.location, "København, Denmark");
  assert.equal(job.description, "Vi søger…");
  assert.equal(mapAd({ title: "no id" }), null);
});

test("denmark search URL: newest-first, 1-indexed pages", () => {
  const u = new URL(dkUrl("software engineer", 2));
  assert.equal(u.searchParams.get("orderType"), "PublicationDate");
  assert.equal(u.searchParams.get("pageNumber"), "2");
});

// ── Switzerland (Job-Room) ───────────────────────────────────────────────────

test("switzerland parseAd: strips <em> highlights, externalUrl wins", () => {
  const card = parseAd({
    jobAdvertisement: {
      id: "3f39419d",
      publication: { startDate: "2026-08-04" },
      jobContent: {
        jobDescriptions: [{ title: "Head of <em>Software</em> Development", description: "Wir suchen…" }],
        company: { name: "Semax AG" },
        location: { city: "Cham" },
        externalUrl: "https://www.jobs.ch/de/x/",
      },
    },
  })!;
  assert.equal(card.title, "Head of Software Development");
  assert.equal(card.location, "Cham, Switzerland");
  const job = cardToRawJob(card, "full text");
  assert.equal(job.url, "https://www.jobs.ch/de/x/");
  assert.equal(job.description, "full text");
  // No externalUrl → the Job-Room page:
  const bare = parseAd({ jobAdvertisement: { id: "abc", jobContent: { jobDescriptions: [{ title: "T" }] } } })!;
  assert.ok(cardToRawJob(bare).url.includes("job-room.ch/job-search/abc"));
  assert.equal(parseAd({ jobAdvertisement: { jobContent: {} } }), null);
});
