import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  andWhere, liveWhere, openWhere, discoverableWhere,
  pursuedWhere, dismissedWhere, archiveWhere, OPEN_STATUSES,
} from "../src/lib/pool";
import { judgeTargetWhere, judgeQueueWhere, unjudgedWhere } from "../src/lib/fit";

// These are the cheapest tests in the repo and they were the missing ones.
// Every predicate here is a pure function returning a plain object, so a test
// is one deepEqual — and yet drift between hand-written copies of exactly these
// rules caused a 33-hour worker stall, a queue of 67k against a queue of 21k, a
// visa filter erased by a spread, and 445,358 permanently stale vectors.

test("a live posting is not disqualified, not a duplicate, not delisted", () => {
  assert.deepEqual(liveWhere(), {
    disqualified: false, delistedAt: null, duplicateOfId: null,
  });
});

test("the populations that build on live keep all three of its columns", () => {
  for (const [name, where] of [
    ["open", openWhere()],
    ["discoverable", discoverableWhere()],
  ] as const) {
    const w = where as Record<string, unknown>;
    assert.equal(w.disqualified, false, `${name} lost disqualified`);
    assert.equal(w.delistedAt, null, `${name} lost delistedAt`);
    assert.equal(w.duplicateOfId, null, `${name} lost duplicateOfId`);
  }
});

test("status is the only axis the populations differ on", () => {
  assert.deepEqual(openWhere(), { ...liveWhere(), status: { in: ["new", "interested"] } });
  assert.deepEqual(discoverableWhere(), { ...liveWhere(), status: { in: ["new"] } });
});

// Pursued postings are deliberately NOT anchored to live: a job you applied to
// stays yours after its source drops it, and /applied shows the closure as a
// warning rather than dropping the row.
test("pursued and dismissed are status-only, on purpose", () => {
  assert.deepEqual(pursuedWhere(), { status: { in: ["applied", "interview", "offer"] } });
  assert.deepEqual(dismissedWhere(), { status: "ignored" });
});

test("the archive is the disqualified mirror of live", () => {
  assert.deepEqual(archiveWhere(), {
    disqualified: true, delistedAt: null, duplicateOfId: null,
  });
});

// The bug andWhere exists to prevent: `{...a, ...b}` keeps only b's OR.
test("andWhere composes filters that a spread would shadow", () => {
  const a = { OR: [{ visaTier: "yes" }] };
  const b = { OR: [{ score: { gte: 40 } }] };
  assert.deepEqual(andWhere(a, b), { AND: [a, b] });
  assert.equal(Object.keys({ ...a, ...b }).length, 1); // the hazard, demonstrated
});

test("andWhere drops absent parts so callers can pass a flag inline", () => {
  assert.deepEqual(andWhere({ score: { gte: 40 } }, null, undefined), { AND: [{ score: { gte: 40 } }] });
  assert.deepEqual(andWhere(), { AND: [] });
});

// The clock used to be read inside the predicate, so the worker's before and
// after counts ran with cut-offs up to four hours apart and a posting ageing
// out of the window read as work getting done.
test("the judge's freshness window is a parameter, not a hidden read of the clock", () => {
  const now = new Date("2026-08-24T12:00:00Z");
  assert.deepEqual(judgeTargetWhere(true, now), judgeTargetWhere(true, now));
  assert.notDeepEqual(judgeTargetWhere(true, now), judgeTargetWhere(true, new Date("2026-01-01T00:00:00Z")));

  const cutoff = new Date(now.getTime() - 45 * 86_400_000);
  assert.equal(JSON.stringify(judgeTargetWhere(true, now)).includes(cutoff.toISOString()), true);
});

test("the narrow judge target is score-and-visa only — no freshness, no country", () => {
  const narrow = JSON.stringify(judgeTargetWhere(false, new Date()));
  assert.equal(narrow.includes("postedAt"), false);
  assert.equal(narrow.includes("country"), false);
  assert.equal(narrow.includes("sponsorReg"), true);
});

// THE CONTRACT THAT LETS A CHILD PROCESS EXPRESS ITS PARENT'S LANE.
//
// The worker counts a lane and spawns embed-fill to work it. embed-fill cannot
// filter on "not yet judged" — it is embedding, not judging — so it takes the
// population and the policy and leaves the work axis behind. That is only sound
// while the judging queue IS those three parts and nothing else; the moment
// something extra hides inside judgeQueueWhere, the parent counts one set and
// the child walks another. Which is exactly what happened, for 33 hours.
test("the judging queue is exactly population x policy x work", () => {
  const now = new Date("2026-08-24T12:00:00Z");
  assert.deepEqual(
    judgeQueueWhere(true, now),
    andWhere(openWhere(), judgeTargetWhere(true, now), unjudgedWhere()),
  );
});

test("dismissed postings are outside every work queue", () => {
  const statuses = OPEN_STATUSES as readonly string[];
  assert.equal(statuses.includes("ignored"), false);
  assert.equal(statuses.includes("applied"), false);
});

// The guard. A name only stops copies from reappearing if something notices
// when one does — the census that prompted this module found the rule written
// 17 times across 11 files, every copy added by someone who had no name to
// reach for.
test("nothing outside pool.ts hand-assembles a population", () => {
  const offenders: string[] = [];
  // Two status strings on one line is a set being spelled out, whatever shape
  // it takes. The first version of this guard looked for specific array
  // literals and therefore missed both real copies that existed at the time:
  // /applied's five-element STAGES array, and a stat-strip line that summed
  // three snapshot keys — `(sc["applied"] ?? 0) + (sc["interview"] ?? 0) + …`.
  // Neither looked like the pattern; both were the rule, written again.
  const STATUS = /"(new|interested|applied|interview|offer|rejected|ghosted|ignored)"/g;

  for (const dir of ["src", "scripts"]) {
    for (const rel of readdirSync(dir, { recursive: true }) as string[]) {
      const path = join(dir, String(rel));
      if (!/\.tsx?$/.test(path)) continue;
      if (path.replace(/\\/g, "/") === "src/lib/pool.ts") continue;
      const lines = readFileSync(path, "utf8").split("\n");

      lines.forEach((line, i) => {
        const distinct = new Set(line.match(STATUS) ?? []);
        if (distinct.size >= 2) {
          offenders.push(`${path}:${i + 1} — status set spelled out: ${[...distinct].join(" ")}`);
        }
      });

      // The eligibility rule's signature: the duplicate column and the
      // disqualified column within a few lines of each other. Either alone is
      // a legitimate narrower question (dedupe asks only about duplicates; the
      // measurement scripts ask only about the gate).
      lines.forEach((line, i) => {
        if (!line.includes("duplicateOfId: null")) return;
        const window = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
        if (window.includes("disqualified:")) {
          offenders.push(`${path}:${i + 1} — eligibility rule assembled by hand`);
        }
      });
    }
  }

  assert.deepEqual(offenders, [], `use a population from src/lib/pool.ts:\n${offenders.join("\n")}`);
});
