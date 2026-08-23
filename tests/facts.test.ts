import test from "node:test";
import assert from "node:assert/strict";
import { parseFacts } from "../src/lib/facts";

test("parseFacts: reads the model's structured answer", () => {
  const f = parseFacts('{"visaOffered":"yes","seniorityLevel":"senior","languages":["de"],"ghostRisk":false}', "AI Engineer", "");
  assert.equal(f.visaOffered, "yes");
  assert.equal(f.seniorityLevel, "senior");
  assert.equal(f.langReq, "de");
  assert.equal(f.ghostRisk, false);
});

test("parseFacts: 'unclear' visa becomes null, not a guess", () => {
  const f = parseFacts('{"visaOffered":"unclear","seniorityLevel":"unknown","languages":[],"ghostRisk":false}', "Dev", "");
  assert.equal(f.visaOffered, null);
});

test("parseFacts: a broken answer degrades to the deterministic detectors", () => {
  const f = parseFacts("the model rambled", "Staff Engineer", "Sehr gute Deutschkenntnisse erforderlich");
  assert.equal(f.visaOffered, null);
  assert.equal(f.seniorityLevel, "staff");  // regex floor
  assert.equal(f.langReq, "de");            // regex floor
});
