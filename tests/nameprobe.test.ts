import { test } from "node:test";
import assert from "node:assert/strict";
import {
  namesMatch,
  normalizeCompanyName,
  probeCompany,
  slugCandidates,
} from "../src/lib/discovery/nameprobe";

// ── normalization & slug guessing ────────────────────────────────────────────

test("normalize strips legal suffixes and diacritics, keeps identity words", () => {
  assert.equal(normalizeCompanyName("Dream Games GmbH"), "dream games");
  assert.equal(normalizeCompanyName("Müller & Söhne B.V."), "muller sohne");
  assert.equal(normalizeCompanyName("Acme AI, Inc."), "acme ai");
  // Product words are identity — never stripped:
  assert.equal(normalizeCompanyName("Good Job Games"), "good job games");
});

test("slugCandidates: joined + hyphenated; too-short names produce nothing", () => {
  assert.deepEqual(slugCandidates("Dream Games GmbH"), ["dreamgames", "dream-games"]);
  assert.deepEqual(slugCandidates("Azumo"), ["azumo"]);
  assert.deepEqual(slugCandidates("EY"), []); // collision bait
  assert.deepEqual(slugCandidates("B.V."), []);
});

test("namesMatch: the gh:peak guard", () => {
  assert.equal(namesMatch("Peak Games", "Peak Physical Therapy - Upstream"), false);
  assert.equal(namesMatch("Azumo", "Azumo Inc"), true);
  assert.equal(namesMatch("Dream Games", "dreamgames"), true); // spacing-insensitive
  assert.equal(namesMatch("Preply", "Preply Barcelona SL"), true);
  assert.equal(namesMatch("", "Anything"), false);
});

// ── probe orchestration with a scripted prober ───────────────────────────────

function scripted(responses: Record<string, { result: string; companyName?: string | null; jobCount?: number }>) {
  const calls: string[] = [];
  const fn = (async (platform: string, token: string) => {
    calls.push(`${platform}:${token}`);
    return responses[`${platform}:${token}`] ?? { result: "dead" };
  }) as any;
  return { fn, calls };
}

test("first VERIFIED hit wins; live-but-wrong-name slugs are rejected", async () => {
  const { fn, calls } = scripted({
    // greenhouse slug is live but belongs to someone else — must be skipped:
    "greenhouse:dreamgames": { result: "active", companyName: "Dream Physical Therapy" },
    "workable:dreamgames": { result: "active", companyName: "Dream Games Ltd", jobCount: 14 },
  });
  const hit = await probeCompany("Dream Games", fn);
  assert.equal(hit?.platform, "workable");
  assert.equal(hit?.companyName, "Dream Games Ltd");
  assert.ok(calls.includes("greenhouse:dreamgames")); // tried, rejected, moved on
});

test("no verified hit anywhere → null (hyphen variant also tried)", async () => {
  const { fn, calls } = scripted({});
  const hit = await probeCompany("Good Job Games", fn);
  assert.equal(hit, null);
  assert.ok(calls.includes("greenhouse:goodjobgames"));
  assert.ok(calls.includes("greenhouse:good-job-games"));
});

test("nameless probe results can never verify", async () => {
  const { fn } = scripted({
    "greenhouse:azumo": { result: "active", companyName: null },
  });
  assert.equal(await probeCompany("Azumo", fn), null);
});

test("name-matching but EMPTY boards are squats, not hits", async () => {
  const { fn } = scripted({
    "workable:jpmorgan": { result: "active", companyName: "jpmorgan", jobCount: 0 },
  });
  assert.equal(await probeCompany("JPMorgan", fn), null);
});
