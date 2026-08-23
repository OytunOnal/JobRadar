import test from "node:test";
import assert from "node:assert/strict";
import { parseFacts } from "../src/lib/facts";
import { signalExcerpts, trimBoilerplate } from "../src/lib/posting-text";

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

test("signalExcerpts: rescues sponsorship stated at the END of a posting", () => {
  // The measured failure: 66% of postings containing "sponsor" never reached
  // the model — cut by the boilerplate trimmer or past the prompt window.
  const posting = "Head of the posting. ".repeat(120) +
    "\nWhat we offer:\n- Competitive salary\n- We provide full visa sponsorship and relocation support for international hires.";
  const excerpt = signalExcerpts(posting);
  assert.match(excerpt, /visa sponsorship/);
  // ...and the trimmer alone would indeed have destroyed it
  assert.doesNotMatch(trimBoilerplate(posting), /visa sponsorship/);
});

test("signalExcerpts: silent postings produce nothing (no filler in the prompt)", () => {
  assert.equal(signalExcerpts("We build web apps. ".repeat(200)), "");
});
