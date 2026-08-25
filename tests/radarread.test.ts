import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers/testdb";
import { DELISTED_AFTER_DAYS } from "../src/lib/scoring/freshness";

// THE RADAR READING, against a real database.
//
// The pure half — which postings a filter selection asks for — has its tests
// in radar.test.ts. What had none was the half that ASKS: nine queries in
// three waves, living inside the page component, whose invariants could only
// be checked by rendering. The reading follows the storesighting pattern: a
// temp SQLite file, `prisma db push`, seeded rows — its own database, so a
// running worker cannot contend with it and it cannot contend with the pool.

const { teardown } = testDb("jr-radar-");

// Dynamic, so the env above is set before db.ts constructs its client.
const { prisma } = await import("../src/lib/db");
const { readRadar, STARRED_MAX } = await import("../src/lib/view/radar-read");
const { radarFilters } = await import("../src/lib/view/radar");

const NOW = new Date("2026-08-25T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let seq = 0;
function job(over: Record<string, unknown> = {}) {
  seq++;
  return {
    dedupeKey: `k${seq}`,
    source: "eures",
    externalId: `x${seq}`,
    url: `https://example.com/${seq}`,
    title: `Unity Developer ${seq}`,
    company: `Studio ${seq}`,
    status: "new",
    lastSeenAt: NOW,
    score: 50,
    ...over,
  };
}

// The pool this suite reads. Small on purpose: every row is here to make one
// specific invariant falsifiable.
await prisma.job.createMany({
  data: [
    job({ country: "de", fitVerdict: "strong", fitScore: 90 }),
    job({ country: "de" }),
    job({ country: "nl" }),
    job({ country: null, workMode: "remote" }),
    job({ country: null, workMode: "onsite" }),
    // Delisted: a direct source (":" in the name) that stopped listing it
    // while the pool moved on. An aggregator row of the same age STAYS — only
    // a source that speaks for the employer can say a posting is gone. The age
    // is derived from the rule, not hardcoded: a hardcoded 40 kept passing —
    // or failing, for an unrelated reason — whenever DELISTED_AFTER_DAYS moved.
    job({ source: "gh:acme", country: "de", lastSeenAt: days(DELISTED_AFTER_DAYS + 5) }),
    job({ source: "eures", country: "de", lastSeenAt: days(DELISTED_AFTER_DAYS + 5) }),
    // A company mid-application.
    job({ status: "applied", company: "Applied GmbH", country: "de" }),
  ],
});

// One more starred row than the strip may show. The first version of this
// suite asserted `STARRED_MAX > 0` — a compile-time constant, vacuous: delete
// the `take` from the query (the exact regression the bound exists for) and
// it still passed. A bound is only tested by exceeding it.
await prisma.job.createMany({
  data: Array.from({ length: STARRED_MAX + 1 }, () =>
    job({ status: "interested", country: "de", fitScore: 80 })),
});

const none: Record<string, string | undefined> = {};
const TRACKS: string[] = [];

test("the reading returns the discoverable pool, not the pipeline", async () => {
  const r = await readRadar(radarFilters(none, TRACKS), { now: NOW });
  // 5 discoverable + 1 aggregator survivor; the delisted direct-source row,
  // the starred row and the applied row are not discovery results.
  assert.equal(r.filteredCount, 6);
  assert.equal(r.lastPage, 1);
  assert.ok(!r.jobs.some((j) => j.source === "gh:acme"), "gone means hidden");
  assert.ok(r.jobs.some((j) => j.source === "eures" && j.lastSeenAt < NOW),
    "old but aggregator-seen means merely old");
});

test("the chips do not jump while a country is being picked", async () => {
  const before = await readRadar(radarFilters(none, TRACKS), { now: NOW });
  const after = await readRadar(radarFilters({ country: "de" }, TRACKS), { now: NOW });
  // A count that changes as you click it is a count you cannot use: the facet
  // is computed against everything EXCEPT the country selection.
  assert.deepEqual(Object.fromEntries(after.chips.counts), Object.fromEntries(before.chips.counts));
  assert.equal(after.chips.remoteCount, before.chips.remoteCount);
  // But the list itself narrows, and the render is told which selection the
  // query was actually built from.
  assert.ok(after.filteredCount < before.filteredCount);
  assert.ok(after.jobs.every((j) => j.country === "de"));
  assert.deepEqual(after.chips.selected, ["de"]);
});

test("a verdict filter narrows the list to the judged", async () => {
  const r = await readRadar(radarFilters({ verdict: "strong" }, TRACKS), { now: NOW });
  assert.equal(r.filteredCount, 1);
  assert.equal(r.jobs[0]?.fitVerdict, "strong");
});

test("the starred strip ignores the filters entirely", async () => {
  // A search that matches nothing still shows the shortlist: it is the user's
  // own list, not a discovery result.
  const r = await readRadar(radarFilters({ q: "zzz-no-such-posting" }, TRACKS), { now: NOW });
  assert.equal(r.filteredCount, 0);
  assert.equal(r.starred.length, STARRED_MAX, "bounded: one more exists than is shown");
  assert.ok(r.starred.every((j) => j.status === "interested"));
});

test("companies mid-application are named, for the badge and the one-click hide", async () => {
  const r = await readRadar(radarFilters(none, TRACKS), { now: NOW });
  assert.ok(r.appliedCompanies.has("Applied GmbH"));
  assert.equal(r.labelCtx.appliedCompanies, r.appliedCompanies,
    "one set, shared with the label context — not two spellings of it");
  assert.deepEqual(r.labelCtx.now, NOW, "one clock for every card in the response");
});

test.after(async () => {
  await teardown(prisma);
});
