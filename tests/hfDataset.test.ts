import { test } from "node:test";
import assert from "node:assert/strict";
import { latestPartition, rowToHit } from "../src/lib/discovery/hfDataset";

// Real filename shapes from the dataset's repo listing.
const FILES = [
  ".gitattributes",
  "README.md",
  "data/date=2026-04-17/source=ashby/part.parquet",
  "data/date=2026-04-17/source=greenhouse/part.parquet",
  "data/date=2026-08-18/source=ashby/6f945f9760bf4c1bb6a5e85fe23a9ec7-0.parquet",
  "data/date=2026-08-18/source=greenhouse/6f945f9760bf4c1bb6a5e85fe23a9ec7-0.parquet",
  "data/date=2026-08-18/source=lever/6f945f9760bf4c1bb6a5e85fe23a9ec7-0.parquet",
  "data/date=2026-05-01/source=lever/x.parquet",
];

test("latestPartition picks only the newest date, all sources", () => {
  const files = latestPartition(FILES);
  assert.equal(files.length, 3);
  assert.ok(files.every((f) => f.date === "2026-08-18"));
  assert.deepEqual(files.map((f) => f.source).sort(), ["ashby", "greenhouse", "lever"]);
  assert.ok(files[0].url.includes("/resolve/main/data/date=2026-08-18/"));
});

test("latestPartition survives an empty or non-partitioned listing", () => {
  assert.deepEqual(latestPartition([".gitattributes", "README.md"]), []);
  assert.deepEqual(latestPartition([]), []);
});

test("rowToHit prefers apply_url (keeps Lever region logic)", () => {
  const hit = rowToHit("lever", {
    source_slug: "abzena",
    apply_url: "https://jobs.eu.lever.co/abzena/841a353a",
  });
  assert.equal(hit?.platform, "lever");
  assert.equal(hit?.region, "eu"); // from the URL — slug alone couldn't know this
});

test("rowToHit falls back to source_slug when the URL is unusable", () => {
  const hit = rowToHit("ashby", { source_slug: "Tools for Humanity", apply_url: null });
  assert.equal(hit?.platform, "ashby");
  assert.equal(hit?.token, "tools for humanity");
  assert.equal(rowToHit("ashby", { source_slug: "%%bad%%" })?.token, undefined);
});

test("rowToHit rejects unknown dataset sources and cross-platform URLs", () => {
  assert.equal(rowToHit("workday", { source_slug: "x" }), null); // not in the map
  // URL pointing at a different platform than the partition claims: fall back to slug.
  const h = rowToHit("greenhouse", {
    source_slug: "acme",
    apply_url: "https://jobs.ashbyhq.com/other/123",
  });
  assert.equal(h?.platform, "greenhouse");
  assert.equal(h?.token, "acme");
});
