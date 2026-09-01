import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { derivedFields, statedFields, STORE_THRESHOLD, type CurrentRow } from "../src/lib/scoring/derive";
import type { RawJob } from "../src/lib/sources/types";

// A census of every write to a Job row found the derived fields listed by hand
// in four places, drifted apart in six ways. These tests pin the six.

function job(over: Partial<RawJob> = {}): RawJob {
  return {
    source: "gh:acme", externalId: "1", url: "https://boards.greenhouse.io/acme/jobs/1",
    title: "Senior Unity Developer", company: "Acme", location: "Berlin, Germany",
    remote: false, description: "We need 5 years of Unity and C#. Visa sponsorship is available.",
    ...over,
  };
}

const CTX = { country: "de", sponsorReg: false };

function current(over: Partial<CurrentRow> = {}): CurrentRow {
  return {
    visa: "unknown", visaBy: "regex", seniorityLevel: null, seniorityBy: null, workModeBy: null,
    sponsorReg: false, source: "gh:acme", country: "de", ...over,
  };
}

test("the store gate is applied whole, both halves", () => {
  // desc-fill and rescore applied only `s.disqualified`, so a re-scored posting
  // could sit live below the gate an identical new one is rejected by.
  const weak = derivedFields(job({ title: "Barista", description: "Coffee shop." }), CTX);
  assert.equal(weak.disqualified, true);
  assert.equal(weak.score, 0, "a rejected posting scores 0, never its raw score");
  assert.equal(weak.track, "other", "a rejected posting carries no track");
});

test("the history row cannot be written without the fields, and cannot disagree with them", () => {
  // rescore wrote a coerced track to the Job row and the uncoerced one to its
  // own history row, so the two disagreed for every disqualified posting.
  const d = derivedFields(job({ title: "Barista", description: "Coffee shop." }), CTX);
  assert.equal(d.scores.create.score, d.score);
  assert.equal(d.scores.create.track, d.track);
  assert.equal(d.scores.create.disqualified, d.disqualified);
  assert.equal(d.scores.create.reason, d.scoreReason);
});

test("a strong posting keeps its score and its track", () => {
  const d = derivedFields(job(), CTX);
  assert.equal(d.disqualified, false);
  assert.ok(d.score >= STORE_THRESHOLD, `expected >= ${STORE_THRESHOLD}, got ${d.score}`);
  assert.equal(d.scores.create.score, d.score);
});

test("the LLM's seniority verdict outranks the detector", () => {
  // desc-fill lacked this guard, so it demoted the levels of 2,064 postings
  // back to a regex reading on every pass.
  const d = derivedFields(job(), { ...CTX, current: current({ seniorityLevel: "staff", seniorityBy: "llm" }) });
  assert.equal("seniorityLevel" in d, false, "must not overwrite an llm level");
  assert.equal("seniorityBy" in d, false);

  const fresh = derivedFields(job(), { ...CTX, current: current({ seniorityBy: "detector" }) });
  assert.equal("seniorityLevel" in fresh, true, "a detector level is fair game");
});

test("visa always arrives as the full triple, never a bare signal", () => {
  // desc-fill and rescore wrote `visa` raw, so the derived tier kept describing
  // the previous answer and an llm reading lost to a later regex pass.
  const d = derivedFields(job(), CTX);
  assert.equal(typeof d.visa, "string");
  assert.equal("visaBy" in d, true);
  assert.equal("visaTier" in d, true, "the tier is derived in the same breath as the evidence");
});

test("weaker evidence never overwrites stronger", () => {
  const silent = job({ description: "A role at a company." });
  const d = derivedFields(silent, { ...CTX, current: current({ visa: "yes", visaBy: "llm" }) });
  assert.equal(d.visa, "yes", "a regex re-read must not undo what the model read");
  assert.equal(d.visaBy, "llm");
});

test("a source's own structured flag beats our regex", () => {
  const d = derivedFields(job({ visa: "yes", description: "No mention either way." }), CTX);
  assert.equal(d.visa, "yes");
  assert.equal(d.visaBy, "source");
});

test("stated fields are what the source says, and never the date", () => {
  // postedAt is excluded deliberately: a source re-stamping an evergreen ad as
  // "posted today" would launder a dead posting into a fresh one.
  const s = statedFields(job({ title: "Staff Engineer", url: "https://x.co/j/1?utm_source=x" }));
  assert.equal(s.title, "Staff Engineer");
  assert.equal("postedAt" in s, false);
  assert.equal("dedupeKey" in s, false, "identity is not a stated field");
  assert.equal("source" in s, false, "rewriting source would hand the row to another feed-diff sweep");
  assert.equal(s.url.includes("utm_source"), false, "tracking params are stripped");
});

test("derivation reads the text it is given, not the text that arrived", () => {
  // The whole kept-text discipline in one assertion: pass the enriched body and
  // the score follows it, even though the incoming payload was title-only.
  const titleOnly = job({ description: "Senior Unity Developer" });
  const enriched = { ...titleOnly, description: job().description };
  assert.notEqual(derivedFields(enriched, CTX).score, derivedFields(titleOnly, CTX).score);
});

// The guard, extended from tests/poolwhere.test.ts. A name only stops copies
// reappearing if something notices when one does.
test("nothing outside derive.ts assembles the derived fields by hand", () => {
  const offenders: string[] = [];
  const ALLOW = new Set(["src/lib/scoring/derive.ts"]);

  for (const dir of ["src", "scripts"]) {
    for (const rel of readdirSync(dir, { recursive: true }) as string[]) {
      const path = join(dir, String(rel));
      if (!/\.tsx?$/.test(path)) continue;
      const norm = path.replace(/\\/g, "/");
      if (ALLOW.has(norm)) continue;
      const lines = readFileSync(path, "utf8").split("\n");

      lines.forEach((line, i) => {
        // score + track together in a write is the derived-field signature.
        if (!/\bscore:\s/.test(line)) return;
        const window = lines.slice(Math.max(0, i - 3), i + 4).join("\n");
        if (/\btrack:\s/.test(window) && /\bscoreReason:\s/.test(window)) {
          offenders.push(`${norm}:${i + 1} — derived fields assembled by hand`);
        }
      });
    }
  }

  assert.deepEqual(offenders, [], `use derivedFields() from src/lib/scoring/derive.ts:\n${offenders.join("\n")}`);
});

// A verdict without its stamp is invisible to the queue that would re-judge it.
test("nothing outside fit.ts writes a verdict without stamping the prompt version", () => {
  const offenders: string[] = [];

  for (const dir of ["src", "scripts"]) {
    for (const rel of readdirSync(dir, { recursive: true }) as string[]) {
      const path = join(dir, String(rel));
      if (!/\.tsx?$/.test(path)) continue;
      const norm = path.replace(/\\/g, "/");
      // backfill-fit-version.ts used to be excused here; it was a spent migration
      // and has been deleted.
      if (norm === "src/lib/llm/fit.ts") continue;
      const lines = readFileSync(path, "utf8").split("\n");

      lines.forEach((line, i) => {
        if (!/\bfitVerdict:\s/.test(line)) return;
        const window = lines.slice(Math.max(0, i - 6), i + 7).join("\n");
        if (!/fitPromptVersion/.test(window)) {
          offenders.push(`${norm}:${i + 1} — verdict written without fitPromptVersion`);
        }
      });
    }
  }

  assert.deepEqual(offenders, [], `use verdictFields() from src/lib/llm/fit.ts:\n${offenders.join("\n")}`);
});
