import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveUrl,
  scanTextForSlugs,
  shouldResolve,
  smellsLikeAts,
} from "../src/lib/discovery/harvest";

// ── shouldResolve: skip-list and scheme guards ───────────────────────────────

test("shouldResolve skips login walls and SEO farms, keeps the rest", () => {
  assert.equal(shouldResolve("https://www.linkedin.com/jobs/view/123"), false);
  assert.equal(shouldResolve("https://whatjobs.com/jobs/game-developer?id=290"), false);
  assert.equal(shouldResolve("https://www.upwork.com/freelance-jobs/apply/x"), false);
  assert.equal(shouldResolve("https://remotive.com/remote-jobs/software-dev/x-123"), true);
  assert.equal(shouldResolve("https://jobicy.com/jobs/147410-staff-backend"), true);
  assert.equal(shouldResolve("ftp://example.com/x"), false);
  assert.equal(shouldResolve("not a url"), false);
});

// ── drift telemetry ──────────────────────────────────────────────────────────

test("smellsLikeAts flags job-ish hosts, ignores ordinary sites", () => {
  assert.equal(smellsLikeAts("jobs.eu.lever.co"), true);
  assert.equal(smellsLikeAts("careers.spotify.com"), true);
  assert.equal(smellsLikeAts("apply.polymer.co"), true);
  assert.equal(smellsLikeAts("acme.wd5.myworkdayjobs.com"), true);
  assert.equal(smellsLikeAts("www.google.com"), false);
  assert.equal(smellsLikeAts("cdn.example.net"), false);
});

// ── tier 3: HTML scanning ────────────────────────────────────────────────────

test("scanTextForSlugs finds apply links and embeds in HTML", () => {
  const html = `
    <div class="apply">
      <a href="https://jobs.lever.co/dreamgames/ddd317b1-11f6-4477">Apply now</a>
    </div>
    <iframe src="https://boards.greenhouse.io/embed/job_app?for=peak&token=400"></iframe>
    <script src="//jobs.ashbyhq.com/supabase/embed"></script>
    <a href="https://www.example.com/about">About us</a>`;
  const { hits } = scanTextForSlugs(html);
  const tokens = hits.map((h) => `${h.platform}:${h.token}`).sort();
  assert.deepEqual(tokens, ["ashby:supabase", "greenhouse:peak", "lever:dreamgames"]);
});

test("scanTextForSlugs reports unmatched ATS-smelling hosts as telemetry", () => {
  const html = `<a href="https://careers.futurecorp.io/openings/123">Jobs</a>
                <a href="https://jobs.newats.dev/acme">Apply</a>`;
  const { hits, smells } = scanTextForSlugs(html);
  assert.equal(hits.length, 0);
  assert.deepEqual(smells.sort(), ["careers.futurecorp.io", "jobs.newats.dev"]);
});

// ── tier 2: redirect chain with a scripted fake fetch ────────────────────────

function fakeFetch(routes: Record<string, { status: number; location?: string; body?: string; type?: string }>): typeof fetch {
  return (async (input: any) => {
    const url = String(input);
    const r = routes[url];
    if (!r) throw new Error(`unexpected fetch: ${url}`);
    return {
      status: r.status,
      headers: {
        get: (name: string) =>
          name === "location" ? r.location ?? null :
          name === "content-type" ? r.type ?? "text/html" : null,
      },
      text: async () => r.body ?? "",
    } as unknown as Response;
  }) as typeof fetch;
}

test("resolveUrl catches the ATS in a redirect hop (Adzuna-style bridge)", async () => {
  const f = fakeFetch({
    "https://aggregator.example/land/ad/123": {
      status: 302,
      location: "https://boards.greenhouse.io/dreamgames/jobs/456",
    },
  });
  const r = await resolveUrl("https://aggregator.example/land/ad/123", f);
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].token, "dreamgames");
});

test("resolveUrl falls through to HTML scan when the chain ends on a landing page", async () => {
  const f = fakeFetch({
    "https://remotive.example/remote-jobs/dev-role": {
      status: 200,
      body: '<a href="https://apply.workable.com/gamigo/j/4C21C8E4A3">Apply</a>',
    },
  });
  const r = await resolveUrl("https://remotive.example/remote-jobs/dev-role", f);
  assert.equal(r.hits[0]?.platform, "workable");
  assert.equal(r.hits[0]?.token, "gamigo");
});

test("resolveUrl stops when redirected into a skip-listed wall", async () => {
  const f = fakeFetch({
    "https://aggregator.example/go/1": {
      status: 302,
      location: "https://www.linkedin.com/jobs/view/999",
    },
  });
  const r = await resolveUrl("https://aggregator.example/go/1", f);
  assert.equal(r.hits.length, 0);
});

test("resolveUrl gives up after the hop limit instead of looping", async () => {
  const routes: any = {};
  for (let i = 0; i < 10; i++) {
    routes[`https://loop.example/${i}`] = { status: 302, location: `https://loop.example/${i + 1}` };
  }
  const r = await resolveUrl("https://loop.example/0", fakeFetch(routes));
  assert.equal(r.hits.length, 0); // and it returned — no infinite loop
});
