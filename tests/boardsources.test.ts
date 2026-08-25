import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers/testdb";

// WHICH BOARDS AN INGEST IS OFFERED.
//
// Two different questions wear the same shape. A normal run asks "who deserves
// this run's request budget", and the answer is a fair rotation: stalest first,
// only what is due, capped. A TARGETED run has already answered it — `--only
// recruitee` exists to re-fetch a platform whose connector was fixed — and
// running it through the rotation was silently gutting it: the selection
// narrowed a list the rotation had already narrowed for its own reasons, so a
// repair could touch a handful of the platform's boards, or none at all if a
// sweep had just stamped them all.

const { teardown } = testDb("jr-boards-");

const { prisma } = await import("../src/lib/db");
const { boardSources, isDue } = await import("../src/lib/discovery/boardSources");

const NOW = new Date("2026-08-25T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

// greenhouse and recruitee both have fetchers wired; without one a board is
// discover-and-park and never becomes a source at all.
await prisma.atsBoard.createMany({
  data: [
    // Freshly stamped — not due. A sweep that just ran leaves the pool like this.
    ...Array.from({ length: 6 }, (_, i) => ({
      platform: "recruitee", token: `swept${i}`, status: "active",
      discoveredVia: "seed", lastFetchedAt: daysAgo(0), fetchIntervalDays: 7,
    })),
    // Due, and enough of them to push past a small limit.
    ...Array.from({ length: 5 }, (_, i) => ({
      platform: "greenhouse", token: `due${i}`, status: "active",
      discoveredVia: "seed", lastFetchedAt: daysAgo(30), fetchIntervalDays: 1,
    })),
    // Never fetched at all.
    { platform: "recruitee", token: "virgin", status: "active", discoveredVia: "seed" },
    // Not active: a candidate is not a source, targeted or not.
    { platform: "recruitee", token: "candidate", status: "candidate", discoveredVia: "seed" },
  ],
});

const names = async (...args: Parameters<typeof boardSources>) =>
  (await boardSources(...args)).map((s) => s.name).sort();

test("a due board is offered, a freshly stamped one is not", async () => {
  const got = await names();
  assert.ok(got.includes("board:greenhouse:due0"));
  assert.ok(got.includes("board:recruitee:virgin"), "never fetched is always due");
  assert.ok(!got.some((n) => n.includes("swept")), "its interval has not elapsed");
});

test("the rotation is capped, so one run cannot claim the whole pool", async () => {
  assert.equal((await names(3)).length, 3);
});

test("a targeted run is offered every board, cap and due check included", async () => {
  // The two halves the finding was about: `--only recruitee` after a sweep got
  // nothing, because every recruitee board had just been stamped; and with a
  // pool larger than the limit it got an arbitrary slice of whatever the
  // rotation happened to be holding.
  const got = await names(3, { all: true });
  assert.equal(got.length, 12, "six swept + five due + one never-fetched");
  assert.ok(got.includes("board:recruitee:swept0"), "not due is not the same as not wanted");
  assert.ok(!got.includes("board:recruitee:candidate"), "still only active boards");
});

test("being asked for everything does not change what a board IS", async () => {
  // `all` relaxes who gets picked, never the predicate itself — a caller
  // reading isDue elsewhere must get the same answer.
  assert.equal(isDue(daysAgo(0), 7, NOW), false);
  assert.equal(isDue(daysAgo(30), 1, NOW), true);
  assert.equal(isDue(null, 99, NOW), true);
});

test.after(async () => {
  await teardown(prisma);
});
