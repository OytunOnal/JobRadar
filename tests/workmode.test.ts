import test from "node:test";
import assert from "node:assert/strict";
import { detectWorkMode } from "../src/lib/text/workmode";
import { workModeFields } from "../src/lib/scoring/derive";
import type { RawJob } from "../src/lib/sources/types";

// The detector was built against 1,502 employer-stated Lever postings and
// validated on a 705-posting holdout its rules were never tuned on. These
// tests pin the behaviours those measurements paid for; the numbers live in
// the module comment.

// ── Position: the arrangement is stated beside the location ─────────────────

test("the location field speaks with authority", () => {
  assert.equal(detectWorkMode("Engineer", "Barcelona - Hybrid", ""), "hybrid");
  assert.equal(detectWorkMode("Engineer", "Berlin Office (Hybrid)", ""), "hybrid");
  assert.equal(detectWorkMode("Engineer", "Remote (EU)", ""), "remote");
  assert.equal(detectWorkMode("Engineer", "Oxford (On-site)", ""), "onsite");
});

test("a location offering a choice is skipped, not read", () => {
  // "San Francisco OR Remote" names what is negotiable — employers filed
  // those under hybrid as often as remote. The field is skipped entirely and
  // later evidence still gets its turn.
  assert.equal(detectWorkMode("Engineer", "San Francisco OR Remote", ""), null);
  assert.equal(detectWorkMode("Engineer", "London or Remote", "on a hybrid basis"), null);
  // A choice between two CITIES narrows nothing about the arrangement — and
  // must not blank a field that also states one.
  assert.equal(detectWorkMode("Engineer", "Berlin and Munich (Hybrid)", ""), "hybrid");
});

test("the title carries it when the location is a bare city", () => {
  assert.equal(detectWorkMode("Backend Engineer - Remote", "Vilnius", ""), "remote");
  assert.equal(detectWorkMode("Data Engineer (Hybrid)", "Manchester", ""), "hybrid");
});

// ── Vocabulary is not enough: the failure modes the old rule shipped ────────

test("hybrid deep in the body is architecture, not an arrangement", () => {
  // The old whole-description scan read every one of these as hybrid — 4.3%
  // of its hybrid pool was hybrid search/cloud/casual, and a further 36% was
  // a bare word it had no position evidence for.
  for (const tech of [
    "We build hybrid search over a vector index.",
    "Operate on-prem and hybrid cloud environments at scale.",
    "150 titles across the hybrid casual space.",
  ]) {
    assert.equal(detectWorkMode("Engineer", "Berlin", tech), null, tech);
  }
});

test("remote-first in the body is the company's culture, not this role", () => {
  // Ovoko: seven Vilnius postings, hybrid and onsite by the employer's own
  // field, every one opening with the same remote-first paragraph.
  assert.equal(
    detectWorkMode("Account Manager", "Vilnius", "We are a remote-first company transforming the industry."),
    null,
  );
});

test("remote set phrases in the body are trusted", () => {
  assert.equal(detectWorkMode("Engineer", "", "This is a fully remote position."), "remote");
  assert.equal(detectWorkMode("Engineer", "", "Work from anywhere in Europe."), "remote");
});

test("negated remote never reads as remote", () => {
  assert.equal(detectWorkMode("Engineer (not remote)", "Berlin", ""), null);
  assert.equal(detectWorkMode("Engineer", "", "This is not a fully remote role."), null);
});

test("silence is the usual answer, and it is null — never a guess", () => {
  // 75% of employer-stated onsite postings mention no arrangement at all.
  // The old rule answered "onsite" here; its measured accuracy was 46.7%.
  assert.equal(detectWorkMode("Software Engineer", "Istanbul", "We need 5 years of C#."), null);
});

// ── The layer: source > text > llm > unknown ────────────────────────────────

function raw(over: Partial<RawJob> = {}): RawJob {
  return {
    source: "gh:acme", externalId: "1", url: "https://x", title: "Engineer",
    company: "Acme", location: "Berlin", remote: false, description: "text",
    ...over,
  };
}

test("a source statement outranks everything and says so", () => {
  assert.deepEqual(
    workModeFields(raw({ workMode: "hybrid", description: "fully remote" })),
    { workMode: "hybrid", workModeBy: "source" },
  );
});

test("a stated mode survives a sighting whose source went silent", () => {
  // Absent keys leave the row alone — the spread pattern's way of saying
  // "what was true stays true".
  assert.deepEqual(workModeFields(raw(), { workModeBy: "source" }), {});
});

test("the detector answers where the source is silent", () => {
  assert.deepEqual(
    workModeFields(raw({ location: "Berlin (Hybrid)" })),
    { workMode: "hybrid", workModeBy: "text" },
  );
});

test("the detector may overwrite the LLM — it is the measured one", () => {
  assert.deepEqual(
    workModeFields(raw({ location: "Remote (EU)" }), { workModeBy: "llm" }),
    { workMode: "remote", workModeBy: "text" },
  );
});

test("but detector silence never erases an LLM answer", () => {
  assert.deepEqual(workModeFields(raw(), { workModeBy: "llm" }), {});
});

test("nobody said: unknown, authored by no one", () => {
  assert.deepEqual(workModeFields(raw()), { workMode: "unknown", workModeBy: null });
});
