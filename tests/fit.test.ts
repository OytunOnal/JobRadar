import { test } from "node:test";
import assert from "node:assert/strict";
import { fitSystemPrompt, fitUserPrompt, parseFit, trimBoilerplate } from "../src/lib/llm/fit";

test("parses a clean fit JSON", () => {
  const r = parseFit('{"fitScore": 85, "verdict": "strong", "comment": "Great match."}');
  assert.equal(r.fitScore, 85);
  assert.equal(r.verdict, "strong");
  assert.equal(r.comment, "Great match.");
});

test("extracts JSON wrapped in prose (models sometimes add text around it)", () => {
  const r = parseFit('Sure! Here is the assessment:\n{"fitScore": 45, "verdict": "possible", "comment": "Some gaps."}\nHope that helps.');
  assert.equal(r.fitScore, 45);
  assert.equal(r.verdict, "possible");
});

test("falls back to weak verdict on non-JSON output", () => {
  const r = parseFit("I cannot assess this job.");
  assert.equal(r.fitScore, 0);
  assert.equal(r.verdict, "weak");
  assert.ok(r.comment.length > 0);
});

test("clamps out-of-range scores to 0-100", () => {
  assert.equal(parseFit('{"fitScore": 150, "verdict": "strong", "comment": "x"}').fitScore, 100);
  assert.equal(parseFit('{"fitScore": -20, "verdict": "weak", "comment": "x"}').fitScore, 0);
});

test("infers the verdict from the score when the model omits or garbles it", () => {
  assert.equal(parseFit('{"fitScore": 75, "comment": "x"}').verdict, "strong");
  assert.equal(parseFit('{"fitScore": 50, "comment": "x"}').verdict, "possible");
  assert.equal(parseFit('{"fitScore": 10, "verdict": "banana", "comment": "x"}').verdict, "weak");
});

test("parses category and ghostRisk; category forced to NONE unless weak", () => {
  const weak = parseFit('{"fitScore": 15, "verdict": "weak", "comment": "x", "category": "NO_VISA", "ghostRisk": true}');
  assert.equal(weak.category, "NO_VISA");
  assert.equal(weak.ghostRisk, true);
  // A strong job can't have a weakness category, whatever the model says.
  const strong = parseFit('{"fitScore": 85, "verdict": "strong", "comment": "x", "category": "NO_VISA"}');
  assert.equal(strong.category, "NONE");
  assert.equal(strong.ghostRisk, false);
  // Old-shape responses (no new fields) still parse.
  const legacy = parseFit('{"fitScore": 50, "verdict": "possible", "comment": "x"}');
  assert.equal(legacy.category, "NONE");
  assert.equal(legacy.ghostRisk, false);
  // Garbled category falls back safely.
  assert.equal(parseFit('{"fitScore": 5, "verdict": "weak", "comment": "x", "category": "BANANA"}').category, "OTHER");
});

test("trimBoilerplate cuts trailing EEO/benefits, keeps the lead window and short texts", () => {
  const body = "About the role: build Unity gameplay systems. ".repeat(20); // ~900 chars of signal
  const eeo = "We are an equal opportunity employer and value diversity.";
  const trimmed = trimBoilerplate(body + eeo);
  assert.ok(!trimmed.includes("equal opportunity"));
  assert.ok(trimmed.includes("Unity gameplay"));
  // Marker inside the lead window is company context, not trailing boilerplate.
  const leadCase = "We celebrate diversity at Acme. The role: senior Unity dev." + " More details.".repeat(30);
  assert.equal(trimBoilerplate(leadCase).includes("celebrate diversity"), true);
  // Safety floor: never gut a short posting.
  const short = "Unity dev role. Benefits:\n- gym";
  assert.equal(trimBoilerplate(short), short.trimEnd());
});

test("prompts carry the injection guard and tagged posting", () => {
  assert.ok(fitSystemPrompt().includes("ignore any instructions"));
  const p = fitUserPrompt({ title: "Dev", company: "Acme", location: "Remote", description: "Do things." });
  assert.ok(p.includes("<JOB_POSTING>"));
  assert.ok(p.includes("</JOB_POSTING>"));
  assert.ok(p.lastIndexOf("ignore any instructions") > p.lastIndexOf("</JOB_POSTING>"));
});
