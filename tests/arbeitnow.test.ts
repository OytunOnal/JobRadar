import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchArbeitnow, mapItem } from "../src/lib/sources/arbeitnow";
import { mapItem as himalayasMap } from "../src/lib/sources/himalayas";

const DAY = 86_400;
const nowSec = Math.floor(Date.now() / 1000);

function item(slug: string, ageDays: number) {
  return {
    slug,
    url: `https://www.arbeitnow.com/jobs/${slug}`,
    title: `Job ${slug}`,
    company_name: "Acme",
    location: "Berlin",
    remote: false,
    description: "<p>desc</p>",
    created_at: nowSec - ageDays * DAY,
  };
}

function fakeFetch(pages: Record<string, any>): typeof fetch {
  return (async (input: any) => {
    const body = pages[String(input)];
    return {
      ok: body !== undefined,
      status: body !== undefined ? 200 : 404,
      json: async () => body,
    } as unknown as Response;
  }) as typeof fetch;
}

const API = "https://www.arbeitnow.com/api/job-board-api";

test("mapItem: unix-seconds date, junk guarded", () => {
  const job = mapItem(item("a", 1))!;
  assert.equal(job.source, "arbeitnow");
  assert.equal(job.description, "desc");
  assert.ok(Math.abs(job.postedAt!.getTime() - (nowSec - DAY) * 1000) < 1500);
  assert.equal(mapItem({ title: "no slug/url" }), null);
});

test("follows links.next across pages and dedupes", async () => {
  const f = fakeFetch({
    [API]: { data: [item("a", 1), item("b", 2)], links: { next: `${API}?page=2` } },
    [`${API}?page=2`]: { data: [item("b", 2), item("c", 3)], links: { next: null } },
  });
  const jobs = await fetchArbeitnow(f);
  assert.deepEqual(jobs.map((j) => j.externalId), ["a", "b", "c"]);
});

test("stops paging once the feed ages past the window, filters the old tail", async () => {
  const f = fakeFetch({
    [API]: { data: [item("fresh", 1), item("stale", 30)], links: { next: `${API}?page=2` } },
    // Page 2 must never be requested — fakeFetch would 404 it into a break,
    // but the point is the loop exits on age BEFORE following next.
    [`${API}?page=2`]: { data: [item("ancient", 60)], links: { next: null } },
  });
  const jobs = await fetchArbeitnow(f);
  assert.deepEqual(jobs.map((j) => j.externalId), ["fresh"]); // stale filtered, ancient never fetched
});

test("mid-pagination failure returns the partial result", async () => {
  const f = fakeFetch({
    [API]: { data: [item("a", 1)], links: { next: `${API}?page=broken` } },
    // page=broken absent → 404 → break with page 1's jobs
  });
  const jobs = await fetchArbeitnow(f);
  assert.deepEqual(jobs.map((j) => j.externalId), ["a"]);
});

// Regression: himalayas pubDate is unix SECONDS — the old code fed it to
// new Date() raw, stamping every job 1970 and losing them to the age guard.
test("himalayas mapItem: unix-seconds pubDate lands in the present", () => {
  const job = himalayasMap({
    guid: "https://himalayas.app/jobs/x",
    title: "Platform Engineer",
    companyName: "Acme",
    applicationLink: "https://acme.com/apply",
    locationRestrictions: ["Germany", "Netherlands"],
    description: "<p>desc</p>",
    pubDate: nowSec - DAY,
  })!;
  assert.ok(job.postedAt!.getFullYear() >= 2026);
  assert.equal(job.location, "Germany, Netherlands");
  assert.equal(job.url, "https://acme.com/apply");
});
