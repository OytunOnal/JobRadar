import { test } from "node:test";
import assert from "node:assert/strict";
import { curatedKeys, isDue } from "../src/lib/discovery/boardSources";

test("isDue: never-fetched boards are always due", () => {
  assert.equal(isDue(null, 1), true);
  assert.equal(isDue(null, 30), true);
});

test("isDue honors fetchIntervalDays", () => {
  const now = new Date("2026-08-19T12:00:00Z");
  const twoDaysAgo = new Date("2026-08-17T12:00:00Z");
  assert.equal(isDue(twoDaysAgo, 1, now), true); // daily board, 2 days stale
  assert.equal(isDue(twoDaysAgo, 7, now), false); // weekly board, not yet
  assert.equal(isDue(twoDaysAgo, 2, now), true); // exactly at the boundary
});

test("curatedKeys matches companies.ts entries so boards are not fetched twice", () => {
  const keys = curatedKeys();
  // Real entries from the curated list — provider ids equal registry platform ids.
  assert.ok(keys.has("greenhouse:peak"));
  assert.ok(keys.has("lever:dreamgames"));
  assert.ok(keys.has("ashby:supabase"));
  assert.ok(keys.has("smartrecruiters:gameloft")); // curated as "Gameloft" — key is lowercased
  assert.ok(!keys.has("workable:azumo")); // discovered, not curated
});
