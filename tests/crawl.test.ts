import { test } from "node:test";
import assert from "node:assert/strict";
import { cdxExpr, extractAll, parseCdxLines } from "../src/lib/discovery/crawl";
import type { SlugHit } from "../src/lib/discovery/extract";

test("cdxExpr maps crawlDomains to the right CDX query expression", () => {
  assert.equal(cdxExpr("apply.workable.com"), "apply.workable.com/*"); // exact host
  assert.equal(cdxExpr("*.recruitee.com"), "*.recruitee.com"); // whole domain
  assert.equal(cdxExpr("join.com/companies"), "join.com/companies/*"); // host+path
  assert.equal(cdxExpr("boards.greenhouse.io/"), "boards.greenhouse.io/*"); // trailing slash
});

test("parseCdxLines handles CC json lines, Wayback plain lines, and junk", () => {
  const text = [
    '{"url": "https://boards.greenhouse.io/snagajob/jobs/1"}',
    "https://jobs.lever.co/dreamgames/uuid",
    '{"broken json',
    "not a url at all",
    "",
    '{"url": 42}',
  ].join("\n");
  assert.deepEqual(parseCdxLines(text), [
    "https://boards.greenhouse.io/snagajob/jobs/1",
    "https://jobs.lever.co/dreamgames/uuid",
  ]);
});

test("extractAll dedupes across sources and counts raw hits", () => {
  const into = new Map<string, SlugHit>();
  const n1 = extractAll(
    [
      "https://boards.greenhouse.io/snagajob/jobs/1",
      "https://boards.greenhouse.io/snagajob/jobs/2", // same board again
      "https://jobs.eu.lever.co/abzena/x",
      "https://example.com/nothing",
    ],
    into,
  );
  assert.equal(n1, 3); // three extractable URLs...
  assert.equal(into.size, 2); // ...two unique boards
  // A later source adding the same board doesn't duplicate it
  extractAll(["https://BOARDS.greenhouse.io/SnagAJob"], into);
  assert.equal(into.size, 2);
  // Region survives in the key: same token on US vs EU stays distinct
  extractAll(["https://jobs.lever.co/abzena/y"], into);
  assert.equal(into.size, 3);
});
