import test from "node:test";
import assert from "node:assert/strict";
import { detectLanguageRequirements } from "../src/lib/scoring/langreq";

test("langreq: hard requirements detected across languages", () => {
  assert.deepEqual(detectLanguageRequirements("Sehr gute Deutschkenntnisse erforderlich"), ["de"]);
  assert.deepEqual(detectLanguageRequirements("Fluent German and English required"), ["de"]);
  assert.deepEqual(detectLanguageRequirements("Maîtrise du français exigée"), ["fr"]);
  assert.deepEqual(detectLanguageRequirements("Vloeiend Nederlands is vereist"), ["nl"]);
  assert.deepEqual(detectLanguageRequirements("German C1 or above"), ["de"]);
});

test("langreq: hedged mentions are not requirements", () => {
  assert.deepEqual(detectLanguageRequirements("German is a plus but not required"), []);
  assert.deepEqual(detectLanguageRequirements("Deutschkenntnisse von Vorteil"), []);
  assert.deepEqual(detectLanguageRequirements("Dutch nice to have"), []);
});

test("langreq: plain English postings detect nothing", () => {
  assert.deepEqual(detectLanguageRequirements("You will build LLM agents in Python. Excellent English required."), []);
});
