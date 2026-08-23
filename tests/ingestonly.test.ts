import test from "node:test";
import assert from "node:assert/strict";
import { aggregators } from "../src/lib/ingest";

// The --only filter has to match two differently-named things: an aggregator
// is "eures", while a board is "recruitee:acme". A user asking for
// "recruitee" means every board on that platform.
function selects(names: string[], sourceName: string): boolean {
  const wanted = new Set(names.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const name = sourceName.toLowerCase();
  return wanted.has(name) || wanted.has(name.split(":")[0]);
}

test("--only selects an aggregator by its exact name", () => {
  assert.equal(selects(["eures"], "eures"), true);
  assert.equal(selects(["eures"], "freehire"), false);
});

test("--only selects every board of a platform by its prefix", () => {
  assert.equal(selects(["recruitee"], "recruitee:11bitstudios"), true);
  assert.equal(selects(["recruitee"], "recruitee:acme"), true);
  assert.equal(selects(["recruitee"], "lever:dreamgames"), false);
});

test("--only is case- and whitespace-tolerant, and ignores blanks", () => {
  assert.equal(selects([" Recruitee ", ""], "recruitee:acme"), true);
});

test("the named aggregators actually exist, so a typo cannot silently fetch nothing", () => {
  // These are the sources the text-repair run targets; if one is renamed the
  // repair would quietly skip it.
  const targets = ["eures", "freehire", "arbeitnow", "duunitori", "jobicy", "himalayas"];
  const known = new Set(aggregators.map((s) => s.name.toLowerCase()));
  assert.deepEqual(targets.filter((t) => !known.has(t)), []);
});
