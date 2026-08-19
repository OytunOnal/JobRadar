import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveWorkMode, type RawJob } from "../src/lib/sources/types";

function job(over: Partial<RawJob>): RawJob {
  return {
    source: "test", externalId: "1", url: "https://x", title: "Dev",
    company: "Acme", remote: false, description: "", ...over,
  };
}

test("explicit source workMode always wins", () => {
  assert.equal(deriveWorkMode(job({ workMode: "hybrid", remote: true })), "hybrid");
  assert.equal(deriveWorkMode(job({ workMode: "onsite", description: "hybrid setup" })), "onsite");
});

test("'hybrid' in the text beats the remote flag", () => {
  assert.equal(deriveWorkMode(job({ remote: true, description: "Hybrid: 2 days in office, remote otherwise" })), "hybrid");
  assert.equal(deriveWorkMode(job({ location: "Berlin (Hybrid)" })), "hybrid");
});

test("remote flag, then onsite fallback", () => {
  assert.equal(deriveWorkMode(job({ remote: true })), "remote");
  assert.equal(deriveWorkMode(job({ remote: false, location: "Istanbul" })), "onsite");
});
