import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findCareerLinks,
  parseWebsiteAnswers,
  scanCompanySite,
  verifyScanHit,
  websitePrompt,
} from "../src/lib/discovery/deepprobe";

// ── website resolution ───────────────────────────────────────────────────────

test("parseWebsiteAnswers normalizes domains and rejects junk", () => {
  const raw = JSON.stringify({
    answers: {
      "1": "https://www.sixteentons.de/en",
      "2": null,
      "3": "linkedin.com/company/x", // social → reject
      "4": "not a domain",
      "5": "PLAYRIX.COM",
    },
  });
  const out = parseWebsiteAnswers(raw, 5);
  assert.deepEqual(out, ["sixteentons.de", null, null, null, "playrix.com"]);
  assert.deepEqual(parseWebsiteAnswers("garbage", 2), [null, null]);
});

test("websitePrompt numbers companies and demands null on uncertainty", () => {
  const p = websitePrompt(["Sixteen Tons Entertainment", "Acme"]);
  assert.ok(p.includes("1. Sixteen Tons Entertainment"));
  assert.ok(p.includes("null"));
});

// ── careers-link discovery ───────────────────────────────────────────────────

test("findCareerLinks keeps same-site hiring paths, drops foreign hosts", () => {
  const html = `
    <a href="/careers">Careers</a>
    <a href="https://acme.com/about">About</a>
    <a href="https://jobs.acme.com/">Jobs portal</a>
    <a href="https://www.linkedin.com/company/acme/jobs">LinkedIn</a>
    <a href="/de/stellenangebote#top">Stellen</a>`;
  const links = findCareerLinks(html, "acme.com");
  assert.ok(links.includes("https://acme.com/careers"));
  assert.ok(links.some((l) => l.startsWith("https://jobs.acme.com")));
  assert.ok(!links.some((l) => l.includes("linkedin")));
  assert.ok(!links.some((l) => l.includes("/about")));
});

// ── site scan + verification with scripted deps ──────────────────────────────

function fakeFetch(pages: Record<string, string>): typeof fetch {
  return (async (input: any) => {
    const url = String(input);
    const body = pages[url];
    return {
      ok: body !== undefined,
      status: body !== undefined ? 200 : 404,
      text: async () => body ?? "",
    } as unknown as Response;
  }) as typeof fetch;
}

test("scanCompanySite: homepage link -> careers page -> ATS embed found", async () => {
  const f = fakeFetch({
    "https://acme.com": '<a href="/careers">Join us</a>',
    "https://acme.com/careers": '<iframe src="https://boards.greenhouse.io/embed/job_app?for=acmegames"></iframe>',
  });
  const hits = await scanCompanySite("acme.com", f);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].platform, "greenhouse");
  assert.equal(hits[0].token, "acmegames");
});

test("scanCompanySite falls back to conventional paths when no link found", async () => {
  const f = fakeFetch({
    "https://acme.com": "<p>marketing fluff, no links</p>",
    "https://acme.com/careers": '<a href="https://jobs.lever.co/acme/123">Apply</a>',
  });
  const hits = await scanCompanySite("acme.com", f);
  assert.equal(hits[0]?.platform, "lever");
});

test("verifyScanHit: live+jobs accepts; empty board or foreign name rejects", async () => {
  const probeOf = (outcome: any) => (async () => outcome) as any;
  const hit = { platform: "lever", token: "acme", dedupeToken: "acme", region: "", host: "" };
  // Lever probes return no name — page evidence + live jobs is enough:
  const ok = await verifyScanHit("Acme", hit, probeOf({ result: "active", companyName: null, jobCount: 5 }));
  assert.equal(ok?.platform, "lever");
  // Empty board = squat/stale embed:
  assert.equal(await verifyScanHit("Acme", hit, probeOf({ result: "active", companyName: null, jobCount: 0 })), null);
  // Name-returning platform with a FOREIGN name = shared/stale board:
  assert.equal(
    await verifyScanHit("Acme", { ...hit, platform: "workable" },
      probeOf({ result: "active", companyName: "Recruiting Agency GmbH", jobCount: 9 })),
    null,
  );
});
