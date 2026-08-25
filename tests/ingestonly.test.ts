import test from "node:test";
import assert from "node:assert/strict";
import { aggregators } from "../src/lib/ingest";
import { companySources } from "../src/lib/sources/companies";
import { selectSources } from "../src/lib/ingest/fetch";
import type { Source } from "../src/lib/sources/types";

// THE --only SELECTION.
//
// This file used to re-implement the matcher inside itself and test the copy:
// delete the real filter from the ingest and every assertion below still
// passed. Which is how the rule could be wrong for two years — `--only
// recruitee` matched nothing, because every discovered board is named
// `board:recruitee:token` and the rule took the segment before the FIRST
// colon. The test's private copy agreed with the comment, not with the code
// the comment was above.

const src = (name: string): Source => ({ name, fetch: async () => [] });
const POOL = [
  "eures", "freehire", "arbeitnow",
  "lever:dreamgames", "greenhouse:wooga",
  "board:recruitee:11bitstudios", "board:recruitee:acme", "board:lever:someco",
  "board:workable:x|eu",
].map(src);

const picked = (only?: string[]): string[] => selectSources(POOL, only).map((s) => s.name);

test("an aggregator is selected by its exact name", () => {
  assert.deepEqual(picked(["eures"]), ["eures"]);
});

test("a platform selects every discovered board on it", () => {
  // The case that never worked.
  assert.deepEqual(picked(["recruitee"]), ["board:recruitee:11bitstudios", "board:recruitee:acme"]);
});

test("a platform name reaches curated companies and discovered boards alike", () => {
  // Both are "lever" to a user; only their names disagree.
  assert.deepEqual(picked(["lever"]), ["lever:dreamgames", "board:lever:someco"]);
});

test("a region-suffixed board still answers to its platform", () => {
  assert.deepEqual(picked(["workable"]), ["board:workable:x|eu"]);
});

test("selections are case- and whitespace-tolerant, and ignore blanks", () => {
  assert.deepEqual(picked([" Recruitee ", "", "  "]), ["board:recruitee:11bitstudios", "board:recruitee:acme"]);
});

test("no selection means everything, and so does a selection of nothing", () => {
  assert.equal(picked().length, POOL.length);
  assert.equal(picked([]).length, POOL.length);
  assert.equal(picked(["  "]).length, POOL.length, "a blank is not a filter that matches nothing");
});

test("an unknown name selects nothing rather than everything", () => {
  assert.deepEqual(picked(["nothingcorp"]), []);
});

test("a source name is unique, because the whole run uses it as an identity", () => {
  // `report.perSource[name]`, the cooldown lookup, the failed-source set and
  // its retry pass all key on the name. Two sources sharing one would report
  // over each other and retry the wrong one — and nothing else in the ingest
  // would notice, because every one of those is a plain object or Set.
  const names = [...companySources(), ...aggregators].map((s) => s.name.toLowerCase());
  const seen = new Set<string>();
  const dupes = names.filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
  assert.deepEqual(dupes, []);
});

test("the named aggregators actually exist, so a typo cannot silently fetch nothing", () => {
  // These are the sources the text-repair run targets; if one is renamed the
  // repair would quietly skip it.
  const targets = ["eures", "freehire", "arbeitnow", "duunitori", "jobicy", "himalayas"];
  const known = new Set(aggregators.map((s) => s.name.toLowerCase()));
  assert.deepEqual(targets.filter((t) => !known.has(t)), []);
});
