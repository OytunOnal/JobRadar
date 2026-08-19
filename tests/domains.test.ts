import { test } from "node:test";
import assert from "node:assert/strict";
import { isJunkJobUrl, isWallJobUrl, sourceTrust } from "../src/lib/domains";

test("junk detection: SEO farms yes, real sources no", () => {
  // Real junk URLs from our own DB's top-of-board era:
  assert.equal(isJunkJobUrl("https://www.whatjobs.com/jobs/game-developer-junior-senior?id=2902142466"), true);
  assert.equal(isJunkJobUrl("https://www.mysmartpros.com/tuition/job/senior-unity-developer-fully-remote/"), true);
  assert.equal(isJunkJobUrl("https://www.upwork.com/freelance-jobs/apply/Senior-Full-Stack_~022080/"), true); // marketplace gigs, not jobs
  assert.equal(isJunkJobUrl("https://boards.greenhouse.io/dreamgames/jobs/1"), false);
  assert.equal(isJunkJobUrl("https://remotive.com/remote-jobs/x"), false);
  assert.equal(isJunkJobUrl("not a url"), false);
});

test("wall domains are not junk: real jobs, just unresolvable", () => {
  assert.equal(isWallJobUrl("https://www.linkedin.com/jobs/view/123"), true);
  assert.equal(isJunkJobUrl("https://www.linkedin.com/jobs/view/123"), false); // storeable
});

test("sourceTrust tiers: direct ATS > curated boards > mass aggregators", () => {
  assert.equal(sourceTrust("gh:dreamgames"), 2);
  assert.equal(sourceTrust("workable:azumo"), 2);
  assert.equal(sourceTrust("workday:gapinc@wd1/gapinc"), 2);
  assert.equal(sourceTrust("remotive"), 1);
  assert.equal(sourceTrust("weworkremotely"), 1);
  assert.equal(sourceTrust("adzuna"), 0);
  assert.equal(sourceTrust("jsearch"), 0);
});
