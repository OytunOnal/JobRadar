import { test } from "node:test";
import assert from "node:assert/strict";
import { detectVisa } from "../src/lib/visa/visa";

test("explicit sponsorship offers → yes", () => {
  assert.equal(detectVisa("We offer visa sponsorship and a relocation package."), "yes");
  assert.equal(detectVisa("Visa sponsorship is available for this role."), "yes");
  assert.equal(detectVisa("Full relocation support to Berlin, including visa assistance."), "yes");
  assert.equal(detectVisa("We will sponsor your work visa."), "yes");
});

test("explicit refusals → no, and negatives beat positive-looking wording", () => {
  assert.equal(detectVisa("Unfortunately we are unable to provide visa sponsorship."), "no");
  assert.equal(detectVisa("Visa sponsorship is not available for this position."), "no");
  assert.equal(detectVisa("Candidates must already have the right to work in the Netherlands."), "no");
  assert.equal(detectVisa("You must be authorized to work in the US without sponsorship."), "no");
  assert.equal(detectVisa("No visa sponsorship. Great relocation package otherwise!"), "no");
});

test("silent postings → unknown (the honest majority)", () => {
  assert.equal(detectVisa("Build gameplay systems in Unity. Remote-friendly team."), "unknown");
  assert.equal(detectVisa(""), "unknown");
});
