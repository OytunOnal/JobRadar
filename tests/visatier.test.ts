import test from "node:test";
import assert from "node:assert/strict";
import { deriveVisaTier, needsSponsorship, visaEvidenceWins } from "../src/lib/visa/visa";

const job = (over: Partial<Parameters<typeof deriveVisaTier>[0]>) => ({
  visa: "unknown", sponsorReg: false, source: "greenhouse:acme", country: "de", ...over,
});

test("visaTier: an explicit refusal outranks the company's licence", () => {
  // 51 live rows are exactly this: register-listed company, posting says no.
  assert.equal(deriveVisaTier(job({ visa: "no", sponsorReg: true }), []), "no");
});

test("visaTier: posting evidence beats silence; register makes it a maybe", () => {
  assert.equal(deriveVisaTier(job({ visa: "yes" }), []), "yes");
  assert.equal(deriveVisaTier(job({ sponsorReg: true }), []), "maybe");
  assert.equal(deriveVisaTier(job({}), []), "unknown");
});

test("visaTier: a visa-focused source makes silent postings a maybe", () => {
  assert.equal(deriveVisaTier(job({ source: "huntukvisa" }), []), "maybe");
});

test("visaTier: work authorization removes the axis for jobs at home", () => {
  // Turkish user, Turkish job — no sponsorship question exists.
  assert.equal(deriveVisaTier(job({ country: "tr" }), ["tr"]), "not-needed");
  // EU citizen: any EU country needs nothing, the UK still does.
  assert.equal(deriveVisaTier(job({ country: "nl" }), ["eu"]), "not-needed");
  assert.equal(deriveVisaTier(job({ country: "gb", sponsorReg: true }), ["eu"]), "maybe");
});

test("needsSponsorship: unknown location stays conservative", () => {
  assert.equal(needsSponsorship(null, ["tr"]), true);
});

test("visa evidence precedence: llm > source > regex, never downgraded", () => {
  assert.equal(visaEvidenceWins("regex", "llm"), true);
  assert.equal(visaEvidenceWins("source", "llm"), true);
  assert.equal(visaEvidenceWins("llm", "regex"), false);
  assert.equal(visaEvidenceWins("llm", "source"), false);
  assert.equal(visaEvidenceWins("llm", "llm"), true); // a re-read may correct itself
  assert.equal(visaEvidenceWins(null, "regex"), true);
});
