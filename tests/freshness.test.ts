import { test } from "node:test";
import assert from "node:assert/strict";
import { ageLabel, classifyFreshness, tooOldToStore } from "../src/lib/freshness";

const NOW = new Date("2026-08-19T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function job(over: Partial<Parameters<typeof classifyFreshness>[0]> = {}) {
  return {
    postedAt: days(3),
    firstSeenAt: days(3),
    lastSeenAt: days(0),
    source: "lever:dreamgames",
    ...over,
  };
}

// ── classifyFreshness ────────────────────────────────────────────────────────

test("recent postings are fresh", () => {
  assert.equal(classifyFreshness(job(), NOW), "fresh");
  assert.equal(classifyFreshness(job({ postedAt: days(44) }), NOW), "fresh");
});

test("45-180 day old postings are aging", () => {
  assert.equal(classifyFreshness(job({ postedAt: days(60) }), NOW), "aging");
  assert.equal(classifyFreshness(job({ postedAt: days(179) }), NOW), "aging");
});

test("the 2019 Dream Games case: ancient postedAt while still listed = evergreen", () => {
  const j = job({ postedAt: new Date("2019-11-19"), lastSeenAt: days(0) });
  assert.equal(classifyFreshness(j, NOW), "evergreen");
});

test("null postedAt falls back to firstSeenAt", () => {
  assert.equal(classifyFreshness(job({ postedAt: null, firstSeenAt: days(10) }), NOW), "fresh");
  assert.equal(classifyFreshness(job({ postedAt: null, firstSeenAt: days(200) }), NOW), "evergreen");
});

test("direct-source job the pool moved past = delisted (beats evergreen)", () => {
  const poolNewest = days(0);
  const j = job({ postedAt: new Date("2019-11-19"), lastSeenAt: days(20) });
  assert.equal(classifyFreshness(j, NOW, poolNewest), "delisted");
});

test("no delisting when WE stopped ingesting (pool clock stands still)", () => {
  // Job last seen 20 days ago — but so was everything else.
  const poolNewest = days(20);
  const j = job({ lastSeenAt: days(20) });
  assert.equal(classifyFreshness(j, NOW, poolNewest), "fresh");
});

test("aggregator jobs are never delisted by absence (they rotate naturally)", () => {
  const j = job({ source: "adzuna", lastSeenAt: days(30) });
  assert.equal(classifyFreshness(j, NOW, days(0)), "fresh");
});

// ── tooOldToStore ────────────────────────────────────────────────────────────

test("tooOldToStore drops only old aggregator posts", () => {
  assert.equal(tooOldToStore(days(60), true, NOW), true);
  assert.equal(tooOldToStore(days(30), true, NOW), false);
  assert.equal(tooOldToStore(days(60), false, NOW), false); // direct source: keep
  assert.equal(tooOldToStore(null, true, NOW), false); // unknown date: keep, classify later
});

// ── ageLabel ─────────────────────────────────────────────────────────────────

test("ageLabel renders compact ages", () => {
  assert.equal(ageLabel(days(0), NOW), "today");
  assert.equal(ageLabel(days(3), NOW), "3d");
  assert.equal(ageLabel(days(90), NOW), "3mo");
  assert.equal(ageLabel(new Date("2019-11-19"), NOW), "1y+");
});
