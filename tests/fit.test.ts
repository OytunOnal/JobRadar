import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFit } from "../src/lib/fit";

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
