import { test } from "node:test";
import assert from "node:assert/strict";
import {
  comparePrompt,
  findDuplicate,
  parseCandidateIndices,
  parseSameRole,
  titlePrefilterPrompt,
  type DedupJob,
} from "../src/lib/scoring/dedup";

const CANDS: DedupJob[] = [
  { id: "a1", title: "Senior Unity Developer", description: "Build gameplay systems in Unity." },
  { id: "b2", title: "Product Manager", description: "Own the roadmap." },
  { id: "c3", title: "Unity QA Engineer", description: "Test Unity builds." },
];

// ── prompt builders ──────────────────────────────────────────────────────────

test("prefilter prompt numbers candidates and asks for strict JSON", () => {
  const p = titlePrefilterPrompt("Sr. Unity Engineer", CANDS);
  assert.ok(p.includes("1. Senior Unity Developer"));
  assert.ok(p.includes("3. Unity QA Engineer"));
  assert.ok(p.includes('"candidates"'));
});

test("compare prompt carries both postings, trimmed", () => {
  const p = comparePrompt({ title: "Sr. Unity Engineer", description: "x".repeat(5000) }, CANDS[0]);
  assert.ok(p.includes("POSTING A"));
  assert.ok(p.includes("POSTING B"));
  assert.ok(p.length < 6500); // clipped, not the full 5000+ chars twice
});

// ── parsers ──────────────────────────────────────────────────────────────────

test("parseCandidateIndices validates, dedupes, and clamps to range", () => {
  assert.deepEqual(parseCandidateIndices('{"candidates":[1,3]}', 3), [0, 2]);
  assert.deepEqual(parseCandidateIndices('Sure: {"candidates":[3,3,"2"]}', 3), [2, 1]);
  assert.deepEqual(parseCandidateIndices('{"candidates":[0,4,-1]}', 3), []); // out of range
  assert.deepEqual(parseCandidateIndices('{"candidates":"nope"}', 3), []);
  assert.deepEqual(parseCandidateIndices("garbage", 3), []);
});

test("parseSameRole only accepts an explicit true", () => {
  assert.equal(parseSameRole('{"sameRole": true}'), true);
  assert.equal(parseSameRole('{"sameRole": false}'), false);
  assert.equal(parseSameRole('{"sameRole": "yes"}'), false); // uncertainty = not a dupe
  assert.equal(parseSameRole("no json here"), false);
});

// ── funnel orchestration with scripted chat ──────────────────────────────────

function scriptedChat(responses: Array<string | null>, calls: Array<{ tier?: string }> = []) {
  let i = 0;
  return (async (_msgs: any, opts: any) => {
    calls.push({ tier: opts?.tier });
    return responses[i++] ?? null;
  }) as any;
}

test("no same-company candidates: zero LLM calls", async () => {
  const calls: any[] = [];
  const r = await findDuplicate({ title: "Dev", description: "x" }, [], scriptedChat([], calls));
  assert.equal(r.duplicateOfId, null);
  assert.equal(calls.length, 0);
});

test("stage 1 finds nothing: no expensive stage-2 call", async () => {
  const calls: any[] = [];
  const r = await findDuplicate(
    { title: "Data Scientist", description: "ML work" },
    CANDS,
    scriptedChat(['{"candidates":[]}'], calls),
  );
  assert.equal(r.duplicateOfId, null);
  assert.equal(r.compareCalls, 0);
  assert.deepEqual(calls.map((c) => c.tier), ["fast"]);
});

test("stage 2 confirms: duplicate id returned, tiers used correctly", async () => {
  const calls: any[] = [];
  const r = await findDuplicate(
    { title: "Sr. Unity Engineer", description: "Gameplay systems role." },
    CANDS,
    scriptedChat(['{"candidates":[1,3]}', '{"sameRole": true}'], calls),
  );
  assert.equal(r.duplicateOfId, "a1"); // first candidate confirmed — QA never compared
  assert.equal(r.compareCalls, 1);
  assert.deepEqual(calls.map((c) => c.tier), ["fast", "strong"]);
});

test("stage 2 rejects all candidates: not a duplicate", async () => {
  const r = await findDuplicate(
    { title: "Sr. Unity Engineer", description: "Gameplay systems role." },
    CANDS,
    scriptedChat(['{"candidates":[1,3]}', '{"sameRole": false}', '{"sameRole": false}']),
  );
  assert.equal(r.duplicateOfId, null);
  assert.equal(r.compareCalls, 2);
});

test("provider outage (null response) resolves to not-a-duplicate", async () => {
  const r = await findDuplicate({ title: "Dev", description: "x" }, CANDS, scriptedChat([null]));
  assert.equal(r.duplicateOfId, null);
});
