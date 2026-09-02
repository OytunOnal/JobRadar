import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROBE_SIGNATURE,
  boardTitleName,
  isStaleMiss,
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

// ── cache versioning ─────────────────────────────────────────────────────────

test("PROBE_SIGNATURE is order-independent and readable", () => {
  // Sorted join: reordering VERIFIABLE_PLATFORMS must not invalidate caches.
  const parts = PROBE_SIGNATURE.split(",");
  assert.deepEqual(parts, [...parts].sort());
  assert.ok(parts.includes("greenhouse"));
});

test("isStaleMiss: misses go stale across signatures, hits never do", () => {
  assert.equal(isStaleMiss({ found: false, probeVersion: null }), true);
  assert.equal(isStaleMiss({ found: false, probeVersion: "greenhouse" }), true);
  assert.equal(isStaleMiss({ found: false, probeVersion: PROBE_SIGNATURE }), false);
  // A found board is real regardless of what coverage found it:
  assert.equal(isStaleMiss({ found: true, probeVersion: null }), false);
  assert.equal(isStaleMiss({ found: true, probeVersion: "old" }), false);
});

// ── probe orchestration with a scripted prober ───────────────────────────────

function scripted(
  responses: Record<string, { result: string; companyName?: string | null; jobCount?: number }>,
  pages: Record<string, { status: number; text: string }> = {},
) {
  const calls: string[] = [];
  const fn = (async (platform: string, token: string) => {
    calls.push(`${platform}:${token}`);
    return responses[`${platform}:${token}`] ?? { result: "dead" };
  }) as any;
  // HTML tier: scripted pages by URL; anything unscripted 404s.
  const html = async (url: string) => {
    calls.push(`html:${url}`);
    return pages[url] ?? { status: 404, text: "" };
  };
  return { fn, calls, html };
}

test("first VERIFIED hit wins; live-but-wrong-name slugs are rejected", async () => {
  const { fn, calls, html } = scripted({
    // greenhouse slug is live but belongs to someone else — must be skipped:
    "greenhouse:dreamgames": { result: "active", companyName: "Dream Physical Therapy" },
    "workable:dreamgames": { result: "active", companyName: "Dream Games Ltd", jobCount: 14 },
  });
  const hit = await probeCompany("Dream Games", fn, html);
  assert.equal(hit?.platform, "workable");
  assert.equal(hit?.companyName, "Dream Games Ltd");
  assert.ok(calls.includes("greenhouse:dreamgames")); // tried, rejected, moved on
});

test("no verified hit anywhere → null (hyphen variant also tried)", async () => {
  const { fn, calls, html } = scripted({});
  const hit = await probeCompany("Good Job Games", fn, html);
  assert.equal(hit, null);
  assert.ok(calls.includes("greenhouse:goodjobgames"));
  assert.ok(calls.includes("greenhouse:good-job-games"));
});

test("nameless probe results can never verify", async () => {
  const { fn, html } = scripted({
    "greenhouse:azumo": { result: "active", companyName: null },
  });
  assert.equal(await probeCompany("Azumo", fn, html), null);
});

test("name-matching but EMPTY boards are squats, not hits", async () => {
  const { fn, html } = scripted({
    "workable:jpmorgan": { result: "active", companyName: "jpmorgan", jobCount: 0 },
  });
  assert.equal(await probeCompany("JPMorgan", fn, html), null);
});

// ── the HTML verification tier ───────────────────────────────────────────────

test("boardTitleName strips boilerplate, keeps identity", () => {
  assert.equal(boardTitleName("Clera Jobs"), "Clera");
  assert.equal(boardTitleName("Jobs at Dream Games | JOIN"), "Dream Games");
  assert.equal(boardTitleName("Careers at Replika"), "Replika");
  assert.equal(boardTitleName("<![CDATA[Oneflow]]>"), "Oneflow");
  // Bare hyphens are identity, not separators:
  assert.equal(boardTitleName("e-bot7 Careers"), "e-bot7");
});

test("teamtailor: RSS channel title verifies, items carry the live-count", async () => {
  const rss = `<rss><channel><title><![CDATA[Replika]]></title>
    <item><title>Engineer</title></item><item><title>Designer</title></item></channel></rss>`;
  const { fn, html } = scripted({}, {
    "https://replika.teamtailor.com/jobs.rss": { status: 200, text: rss },
  });
  const hit = await probeCompany("Replika", fn, html);
  assert.equal(hit?.platform, "teamtailor");
  assert.equal(hit?.token, "replika");
});

test("teamtailor: live RSS with the WRONG name is someone else's board", async () => {
  const rss = `<rss><channel><title>Peak Physical Therapy</title><item><title>PT</title></item></channel></rss>`;
  const { fn, html } = scripted({}, {
    "https://peakgames.teamtailor.com/jobs.rss": { status: 200, text: rss },
    "https://peak-games.teamtailor.com/jobs.rss": { status: 200, text: rss },
  });
  assert.equal(await probeCompany("Peak Games", fn, html), null);
});

test("join: embedded state carries name and live jobs", async () => {
  const state = { company: { name: "Dream Games", domain: "dreamgames" }, jobs: { items: [{}, {}] } };
  const page = `<html><head><title>Jobs at Dream Games | JOIN</title></head>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { initialState: state } } })}</script></html>`;
  const { fn, html } = scripted({}, {
    "https://join.com/companies/dreamgames": { status: 200, text: page },
  });
  const hit = await probeCompany("Dream Games", fn, html);
  assert.equal(hit?.platform, "join");
  assert.equal(hit?.companyName, "Dream Games");
});

test("ashby: page title verifies the name, the API probe supplies the count", async () => {
  const { fn, html, calls } = scripted(
    { "ashby:clera": { result: "active", jobCount: 14 } },
    { "https://jobs.ashbyhq.com/clera": { status: 200, text: "<title>Clera Jobs</title>" } },
  );
  const hit = await probeCompany("Clera", fn, html);
  assert.equal(hit?.platform, "ashby");
  assert.equal(hit?.companyName, "Clera");
  assert.ok(calls.includes("ashby:clera")); // count came from the API, not the page
});

test("ashby: verified name but an EMPTY board via the API is still a squat", async () => {
  const { fn, html } = scripted(
    { "ashby:hollow": { result: "active", jobCount: 0 } },
    { "https://jobs.ashbyhq.com/hollow": { status: 200, text: "<title>Hollow Jobs</title>" } },
  );
  assert.equal(await probeCompany("Hollow", fn, html), null);
});

test("PROBE_SIGNATURE covers the HTML tier — old five-platform misses read stale", () => {
  for (const p of ["ashby", "join", "teamtailor"]) assert.ok(PROBE_SIGNATURE.includes(p));
  assert.equal(
    isStaleMiss({ found: false, probeVersion: "greenhouse,personio,recruitee,smartrecruiters,workable" }),
    true,
  );
});

// ── Concurrency changed the schedule, not the answer ─────────────────────────

test("the cheap API tier still wins when the HTML tier would also verify", async () => {
  // Both tiers can verify "Dream Games": recruitee by API, join by embedded
  // state. Probed concurrently, the verdicts are read in the original order,
  // so the deterministic tier keeps its priority.
  const { fn, html } = scripted(
    { "recruitee:dreamgames": { result: "active", companyName: "Dream Games", jobCount: 4 } },
    {
      "https://join.com/companies/dreamgames": {
        status: 200,
        text: `<script>{"company":{"name":"Dream Games"},"jobs":{"items":[{"id":1}]}}</script>`,
      },
    },
  );
  const hit = await probeCompany("Dream Games", fn, html);
  assert.equal(hit?.platform, "recruitee", "API tier outranks the HTML tier");
});

test("every platform is asked once per token, and a thrower is not a verdict", async () => {
  const { fn, calls, html } = scripted({});
  const boom = (async () => { throw new Error("network"); }) as any;
  assert.equal(await probeCompany("Nowhere Ltd", boom, html), null, "a throwing probe is a miss, not a crash");
  await probeCompany("Nowhere Ltd", fn, html);
  const apiCalls = calls.filter((c) => !c.startsWith("html:"));
  assert.equal(new Set(apiCalls).size, apiCalls.length, "no host is asked twice for one token");
});
