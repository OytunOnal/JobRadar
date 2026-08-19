import { test } from "node:test";
import assert from "node:assert/strict";
import { probeBoard, titleizeToken } from "../src/lib/discovery/validate";

// ── titleizeToken ────────────────────────────────────────────────────────────

test("titleizeToken prettifies tokens, including workday triples", () => {
  assert.equal(titleizeToken("azumo"), "Azumo");
  assert.equal(titleizeToken("good-job-games"), "Good Job Games");
  assert.equal(titleizeToken("roesberg-engineering-gmbh"), "Roesberg Engineering Gmbh");
  assert.equal(titleizeToken("gapinc@wd1/external"), "Gapinc");
  assert.equal(titleizeToken("kraken.com"), "Kraken Com");
});

// ── probeBoard against scripted responses ────────────────────────────────────

type Route = { status: number; body?: string };

function fakeFetch(
  routes: Record<string, Route>,
  calls: Array<{ url: string; init?: RequestInit }> = [],
): typeof fetch {
  return (async (input: any, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = routes[url];
    if (!r) throw new Error(`unexpected fetch: ${url}`);
    return {
      status: r.status,
      headers: { get: () => null },
      text: async () => r.body ?? "",
    } as unknown as Response;
  }) as typeof fetch;
}

test("workable board: alive, name from the widget body", async () => {
  const f = fakeFetch({
    "https://apply.workable.com/api/v1/widget/accounts/azumo": {
      status: 200,
      body: JSON.stringify({ name: "Azumo", jobs: [{}] }),
    },
  });
  const o = await probeBoard("workable", "azumo", "", f);
  assert.equal(o.result, "active");
  assert.equal(o.companyName, "Azumo");
});

test("greenhouse 404 → dead; 200 body carries the name", async () => {
  const dead = await probeBoard("greenhouse", "gonecorp", "", fakeFetch({
    "https://boards-api.greenhouse.io/v1/boards/gonecorp": { status: 404 },
  }));
  assert.equal(dead.result, "dead");

  const alive = await probeBoard("greenhouse", "peak", "", fakeFetch({
    "https://boards-api.greenhouse.io/v1/boards/peak": {
      status: 200,
      body: JSON.stringify({ name: "Peak Physical Therapy - Upstream" }),
    },
  }));
  assert.equal(alive.result, "active");
  assert.equal(alive.companyName, "Peak Physical Therapy - Upstream");
});

test("smartrecruiters: 200 with totalFound 0 is DEAD (probeAlive rules)", async () => {
  const o = await probeBoard("smartrecruiters", "madeupco", "", fakeFetch({
    "https://api.smartrecruiters.com/v1/companies/madeupco/postings?limit=1": {
      status: 200,
      body: JSON.stringify({ totalFound: 0, content: [] }),
    },
  }));
  assert.equal(o.result, "dead");
});

test("personio: 307 redirect (unfollowed) is dead; live XML gives subcompany", async () => {
  const dead = await probeBoard("personio", "gonecorp", "", fakeFetch({
    "https://gonecorp.jobs.personio.com/xml": { status: 307 },
  }));
  assert.equal(dead.result, "dead");

  const alive = await probeBoard("personio", "intigriti", "", fakeFetch({
    "https://intigriti.jobs.personio.com/xml": {
      status: 200,
      body: "<workzag-jobs><position><subcompany>Intigriti LTD.</subcompany></position></workzag-jobs>",
    },
  }));
  assert.equal(alive.result, "active");
  assert.equal(alive.companyName, "Intigriti LTD.");
});

test("workday probe goes out as a JSON POST (GET would 400)", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = fakeFetch({
    "https://gapinc.wd1.myworkdayjobs.com/wday/cxs/gapinc/gapinc/jobs": {
      status: 200,
      body: JSON.stringify({ total: 226, jobPostings: [] }),
    },
  }, calls);
  const o = await probeBoard("workday", "gapinc@wd1/gapinc", "", f);
  assert.equal(o.result, "active");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.redirect, "manual");
  assert.ok(String(calls[0].init?.body).includes('"limit":1'));
});

test("lever probe respects region routing", async () => {
  const o = await probeBoard("lever", "abzena", "eu", fakeFetch({
    "https://api.eu.lever.co/v0/postings/abzena?mode=json": {
      status: 200,
      body: JSON.stringify([{ id: "x" }]),
    },
  }));
  assert.equal(o.result, "active");
});

test("network failure is an error, never a death sentence", async () => {
  const f = (async () => {
    throw new Error("ECONNRESET");
  }) as unknown as typeof fetch;
  const o = await probeBoard("greenhouse", "peak", "", f);
  assert.equal(o.result, "error");
});
