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
const { selects } = await import("../src/lib/ingest/fetch");

// The real clock, deliberately. These rows are read back through
// boardSources(), which asks isDue without a `now` and therefore gets the real
// one. Anchored to a frozen date, "freshly stamped" meant "stamped on
// 2026-08-25" — true for seven days and false on the eighth, when the fixture's
// own interval elapsed and this file started failing on its own.
//
// A frozen clock is right where the code under test accepts one. Here it only
// froze half the comparison.
const NOW = new Date();
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

test("a targeted run is offered boards that are not due", async () => {
  // `--only recruitee` after a sweep got nothing, because every recruitee
  // board had just been stamped and the rotation only offers what is due.
  const got = await names(20, { all: true });
  assert.equal(got.length, 12, "six swept + five due + one never-fetched");
  assert.ok(got.includes("board:recruitee:swept0"), "not due is not the same as not wanted");
  assert.ok(!got.includes("board:recruitee:candidate"), "still only active boards");
});

test("but it is still bounded — a targeted run is a slice, not the whole pool", async () => {
  // The first version of `all` lifted the cap too, which turned every
  // `--only <platform>` into an unbounded run: 16,741 sources for `join`, on
  // the code path that holds every fetched posting in memory, with the limit
  // silently ignored. One process is not meant to hold a platform.
  assert.equal((await names(3, { all: true })).length, 3);
  assert.equal((await names(7, { all: true })).length, 7);
});

test("successive targeted runs walk the platform instead of repeating it", async () => {
  // Stalest-first plus a stamp on every fetch IS the resumability: the second
  // run cannot be handed the same head of the queue as the first.
  const first = await boardSources(4, { all: true });
  assert.equal(first.length, 4);
  // Fetching is what stamps a board, so simulate the run having done so.
  await prisma.atsBoard.updateMany({
    where: { token: { in: first.map((s) => s.name.split(":")[2].split("|")[0]) } },
    data: { lastFetchedAt: NOW },
  });
  const second = await boardSources(4, { all: true });
  assert.equal(second.length, 4);
  assert.deepEqual(
    second.map((s) => s.name).filter((n) => first.some((f) => f.name === n)),
    [],
    "the second slice shares nothing with the first",
  );
});

test("the slice is taken from the platform asked for, not from the pool", async () => {
  // The bug this whole option exists for, and the one the first fix walked
  // straight back into. `--only join` selecting AFTER a 200-board slice gets
  // whichever of the 200 stalest boards happen to be on join — two, in the
  // real pool, and none at all right after a sweep. A slice of the wrong
  // population is not a smaller answer, it is a different one.
  const onRecruitee = (n: string) => selects(n, ["recruitee"]);
  // Five greenhouse boards are due and would fill any small slice first.
  const got = await boardSources(3, { all: true, wanted: onRecruitee });
  assert.equal(got.length, 3);
  assert.ok(got.every((s) => s.name.startsWith("board:recruitee:")), got.map((s) => s.name).join(", "));
});

test("asking for an aggregator by name offers no boards at all", async () => {
  const got = await boardSources(200, { all: true, wanted: (n) => selects(n, ["eures"]) });
  assert.deepEqual(got, []);
});

test("a targeted run does not write the rotation's ledger", async () => {
  // recordBoardOutcome answers one question — does this board deserve the
  // normal rotation's request budget — and a hand-aimed text repair is not
  // evidence about it. Letting it write meant one `--only recruitee` run
  // finding no new keyword hits and DOUBLING fetchIntervalDays for every board
  // on the platform, pushing thousands it had never judged toward monthly.
  const { recordBoardOutcome } = await import("../src/lib/discovery/boardSources");
  const board = await prisma.atsBoard.create({
    data: {
      platform: "recruitee", token: "ledger", status: "active",
      discoveredVia: "seed", fetchIntervalDays: 4, hitRate: 0.5,
    },
  });
  const name = "board:recruitee:ledger";

  await recordBoardOutcome(name, 50, 0, { targeted: true });
  const untouched = await prisma.atsBoard.findUnique({ where: { id: board.id } });
  assert.equal(untouched!.fetchIntervalDays, 4, "a repair run did not demote it");
  assert.equal(untouched!.hitRate, 0.5);

  // A normal run still says what it found.
  await recordBoardOutcome(name, 50, 0);
  const demoted = await prisma.atsBoard.findUnique({ where: { id: board.id } });
  assert.equal(demoted!.fetchIntervalDays, 8, "no hits, so it is asked half as often");
  assert.ok(demoted!.hitRate < 0.5);
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
