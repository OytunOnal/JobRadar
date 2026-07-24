import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreJob } from "../src/lib/score";
import type { RawJob } from "../src/lib/sources/types";

function mkJob(over: Partial<RawJob>): RawJob {
  return {
    source: "test",
    externalId: "1",
    url: "https://example.com/job",
    title: "",
    company: "TestCo",
    remote: true,
    description: "",
    ...over,
  };
}

test("disqualifies non-engineering roles by title", () => {
  const s = scoreJob(mkJob({ title: "Marketing Manager", description: "unity c# game" }));
  assert.equal(s.disqualified, true);
  assert.equal(s.score, 0);
});

test("disqualifies business roles at tech companies (roleNegatives)", () => {
  const s = scoreJob(mkJob({ title: "Business Development Manager", description: "typescript react" }));
  assert.equal(s.disqualified, true);
});

test("requires an engineering role signal in the title", () => {
  const s = scoreJob(mkJob({ title: "Gameplay Wizard", description: "unity c# mobile game" }));
  assert.equal(s.disqualified, true);
  assert.match(s.reason, /role signal/i);
});

test("classifies a game-developer posting into the unity track with a high score", () => {
  const s = scoreJob(
    mkJob({
      title: "Senior Game Developer",
      description: "We build mobile games in Unity with C# for casual audiences.",
    }),
  );
  assert.equal(s.disqualified, false);
  assert.equal(s.track, "unity");
  assert.ok(s.score >= 60, `expected >= 60, got ${s.score}`);
});

test("body-only matches are capped low and labeled", () => {
  const s = scoreJob(
    mkJob({
      title: "Solutions Developer", // role signal, but no track title keyword
      description: "Stack: typescript, react, postgres.",
      remote: false,
      location: "Berlin, Germany",
    }),
  );
  assert.equal(s.disqualified, false);
  assert.ok(s.score <= 22, `body-only should cap at 22, got ${s.score}`);
  assert.match(s.reason, /body-only/);
});

test("title match outranks body-only for the same vocabulary", () => {
  const titleHit = scoreJob(mkJob({ title: "Full Stack Developer", description: "typescript react" }));
  const bodyOnly = scoreJob(mkJob({ title: "Solutions Developer", description: "full stack typescript react" }));
  assert.ok(titleHit.score > bodyOnly.score);
});

test("rejects on-site jobs outside accepted regions", () => {
  const s = scoreJob(
    mkJob({
      title: "Senior Software Engineer",
      description: "typescript react",
      remote: false,
      location: "San Francisco, USA",
    }),
  );
  assert.equal(s.disqualified, true);
  assert.match(s.reason, /Region/);
});
