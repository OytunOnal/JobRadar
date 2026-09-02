import { test } from "node:test";
import assert from "node:assert/strict";
import { ageLabel, ageWords, classifyFreshness, tooOldToStore } from "../src/lib/scoring/freshness";

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

test("sweep stamp delists immediately — no grace, beats everything", () => {
  const j = job({ postedAt: days(1), delistedAt: days(0) }); // fresh yesterday, gone today
  assert.equal(classifyFreshness(j, NOW, days(0)), "delisted");
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

test("ageWords renders the same ages in words", () => {
  assert.equal(ageWords(days(0), NOW), "today");
  assert.equal(ageWords(days(1), NOW), "yesterday");
  // The day ends at midnight, not 24 hours after the event: applying at noon
  // yesterday is "yesterday" at breakfast today, nine hours later. The
  // elapsed-time version said "today" until each event's own clock time came
  // around again, and every one of yesterday's applications wore it.
  assert.equal(ageWords(new Date("2026-08-18T22:00:00"), new Date("2026-08-19T07:00:00")), "yesterday");
  assert.equal(ageWords(new Date("2026-08-19T01:00:00"), new Date("2026-08-19T23:00:00")), "today");
  assert.equal(ageWords(days(3), NOW), "3 days ago");
  assert.equal(ageWords(days(35), NOW), "1 month ago");
  assert.equal(ageWords(days(90), NOW), "3 months ago");
  assert.equal(ageWords(new Date("2019-11-19"), NOW), "over a year ago");
});

// Every phrase is complete on its own. The version this replaced returned a
// stem callers suffixed with "ago", which shipped as "applied today ago" on
// every card written in the last day, with "1y+ ago" waiting behind it.
test("no ageWords phrase needs a suffix to be a sentence", () => {
  for (const d of [0, 1, 2, 29, 30, 200, 400, 4000]) {
    const words = ageWords(days(d), NOW);
    assert.ok(
      words === "today" || words === "yesterday" || words.endsWith(" ago"),
      `${d}d rendered as ${JSON.stringify(words)}`,
    );
  }
});

// The two renderings answer the same question at two lengths. If they ever
// disagree about which side of a threshold a day falls on, one card says
// "29 days ago" while another says "1mo" for the same posting.
test("ageLabel and ageWords agree about where a day sits", () => {
  for (const d of [0, 1, 29, 30, 364, 365]) {
    const compact = ageLabel(days(d), NOW);
    const words = ageWords(days(d), NOW);
    const bucket = (s: string) =>
      s.includes("today") ? "today"
        : s.includes("year") || s === "1y+" ? "year"
          : s.includes("mo") ? "month" : "day";
    assert.equal(bucket(compact), bucket(words), `${d}d: ${compact} vs ${words}`);
  }
});
