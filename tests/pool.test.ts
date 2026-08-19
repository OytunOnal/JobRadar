import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blendHitRate,
  curatedKeys,
  isDue,
  nextInterval,
  parseBoardSourceName,
} from "../src/lib/discovery/boardSources";

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

test("parseBoardSourceName round-trips tokens, including workday's @ and regions", () => {
  assert.deepEqual(parseBoardSourceName("board:workable:azumo"), {
    platform: "workable", token: "azumo", region: "",
  });
  assert.deepEqual(parseBoardSourceName("board:lever:abzena|eu"), {
    platform: "lever", token: "abzena", region: "eu",
  });
  // Workday tokens contain "@" and "/" — must survive intact.
  assert.deepEqual(parseBoardSourceName("board:workday:gapinc@wd1/gapinc"), {
    platform: "workday", token: "gapinc@wd1/gapinc", region: "",
  });
  assert.equal(parseBoardSourceName("gh:peak"), null); // not a board source
  assert.equal(parseBoardSourceName("board:broken"), null);
});

test("nextInterval backs off on misses, snaps back to daily on a hit", () => {
  assert.equal(nextInterval(1, false), 2);
  assert.equal(nextInterval(2, false), 4);
  assert.equal(nextInterval(16, false), 30); // capped at monthly
  assert.equal(nextInterval(30, false), 30);
  assert.equal(nextInterval(30, true), 1); // one hit rescues the board
});

test("blendHitRate is a 70/30 moving average", () => {
  assert.equal(blendHitRate(0, 1), 0.3);
  assert.equal(blendHitRate(0.5, 0), 0.35);
  assert.equal(blendHitRate(0.2, 0.2), 0.2);
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
