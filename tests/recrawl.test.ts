import test from "node:test";
import assert from "node:assert/strict";
import { cdxDay, checkDue, unscannedIds, CHECK_AFTER_DAYS } from "../src/lib/discovery/recrawl";

const NOW = new Date("2026-09-02T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

// The recurring archive scan's pure core: which indexes are owed, and
// whether today even needs to ask.

test("a fresh install owes exactly the newest index, not a decade", () => {
  // The bulk sweep covered history; "everything unscanned" over an empty
  // memory would mean re-walking every index CC has ever published.
  const collinfo = ["CC-MAIN-2026-36", "CC-MAIN-2026-33", "CC-MAIN-2026-30"];
  assert.deepEqual(unscannedIds(collinfo, new Set()), ["CC-MAIN-2026-36"]);
});

test("missed months self-heal: everything newer than coverage is owed", () => {
  const collinfo = ["CC-MAIN-2026-36", "CC-MAIN-2026-33", "CC-MAIN-2026-30", "CC-MAIN-2026-26"];
  assert.deepEqual(
    unscannedIds(collinfo, new Set(["CC-MAIN-2026-30", "CC-MAIN-2026-26"])),
    ["CC-MAIN-2026-36", "CC-MAIN-2026-33"],
    "two missed months are two owed scans, not one",
  );
});

test("up to date means nothing owed", () => {
  const collinfo = ["CC-MAIN-2026-36", "CC-MAIN-2026-33"];
  assert.deepEqual(unscannedIds(collinfo, new Set(["CC-MAIN-2026-36"])), []);
});

test("the date gate keeps ordinary days offline", () => {
  // While the newest scan is younger than the publication cadence, a new
  // index cannot exist — those days cost a row read and no network.
  assert.equal(checkDue(daysAgo(5), NOW), false);
  assert.equal(checkDue(daysAgo(CHECK_AFTER_DAYS + 1), NOW), true);
  assert.equal(checkDue(null, NOW), true, "no memory yet: ask");
});

test("the wayback cut is a CDX day, not an ISO instant", () => {
  assert.equal(cdxDay(new Date("2026-09-02T07:30:00Z")), "20260902");
});
