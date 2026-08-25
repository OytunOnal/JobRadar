import test from "node:test";
import assert from "node:assert/strict";
import { intake, dedupeKey, contentKey, isAggregatorJob } from "../src/lib/ingest/intake";
import { derivedFields, rejectedBy, STORE_THRESHOLD } from "../src/lib/scoring/derive";
import { scoreJob, type Scored } from "../src/lib/scoring/score";
import type { RawJob } from "../src/lib/sources/types";

// WHAT AN INGEST MAKES OF ONE SIGHTING.
//
// Ten decisions per posting that could only be exercised by running a full
// ingest — ~140 network sources between a test and the guard. All of it is
// pure now, so all of it is here.

const NONE: ReadonlySet<string> = new Set();

function raw(over: Partial<RawJob> = {}): RawJob {
  return {
    source: "gh:acme",
    externalId: "42",
    url: "https://boards.greenhouse.io/acme/jobs/42",
    title: "Senior Unity Developer",
    company: "Acme GmbH",
    location: "Berlin, Germany",
    description: "We are hiring a Unity developer. 5+ years of C# and Unity.",
    postedAt: new Date("2026-08-20T00:00:00Z"),
    ...over,
  } as RawJob;
}

test("a good sighting is stored, scored, and identified", () => {
  const r = intake(raw(), NONE);
  assert.equal(r.store, true);
  assert.equal(r.why, null);
  assert.ok(r.store && r.key.length === 40, "sha1 of source:externalId");
  assert.ok(r.store && r.ck.length === 40);
});

test("an SEO farm's copy never becomes a posting", () => {
  const r = intake(raw({ url: "https://jobrapido.com/x/1" }), NONE);
  assert.equal(r.store, false);
  assert.equal(r.why, "junk");
});

test("an aggregator's repost of something long dead is refused, a board's is not", () => {
  const ancient = { postedAt: new Date("2019-01-01T00:00:00Z") };
  assert.equal(intake(raw({ ...ancient, source: "eures" }), NONE).why, "tooOld");
  assert.equal(intake(raw({ ...ancient, source: "gh:acme" }), NONE).why, null,
    "a company's own board saying a role is open outranks its age");
});

test("a role this run already took is refused, but still counted at its gate", () => {
  // The order matters: the gate census must see every sighting the scorer
  // judged, or a sweep summary reads differently depending on which source
  // happened to arrive first.
  const first = intake(raw(), NONE);
  assert.ok(first.store);
  const again = intake(raw({ externalId: "43", url: "https://x.co/43" }), new Set([first.ck]));
  assert.equal(again.store, false);
  assert.equal(again.why, "duplicate");
  assert.ok("gate" in again, "it was scored before it was recognised");
});

test("the same role from two sources shares a content key, not a dedupe key", () => {
  const a = raw({ source: "gh:acme", externalId: "1", title: "Unity Developer (Remote)" });
  const b = raw({ source: "eures", externalId: "9", title: "Unity Developer (m/f/d)" });
  assert.equal(contentKey(a), contentKey(b), "parentheticals are not the role");
  assert.notEqual(dedupeKey(a), dedupeKey(b));
});

test("a source's own name says whether it speaks for the employer", () => {
  assert.equal(isAggregatorJob(raw({ source: "eures" })), true);
  assert.equal(isAggregatorJob(raw({ source: "gh:acme" })), false);
});

test("named blocks are assembled into the text everything else derives from", () => {
  const r = intake(raw({
    description: "flat fallback",
    sections: [["Requirements", "- 5 years of Unity"], ["Benefits", "- Visa sponsorship"]],
  }), NONE);
  assert.ok(r.posting.description.includes("5 years of Unity"));
  assert.ok(r.posting.description.includes("Visa sponsorship"));
  assert.ok(r.posting.description.includes("\n"), "structure is what the section parser reads");
});

test("an adapter's own text survives when every block came back empty", () => {
  // Lever's structure-destroyed descriptionPlain, Personio's unpaired <value>
  // blocks, a bare title.
  const r = intake(raw({ description: "flat fallback", sections: [["Requirements", ""]] }), NONE);
  assert.equal(r.posting.description, "flat fallback");
});

test("markup is converted AND counted — a connector bug is not silently repaired", () => {
  const r = intake(raw({ description: "<p>Unity dev</p><ul><li>C#</li></ul>" }), NONE);
  assert.equal(r.unconverted, true);
  assert.equal(r.posting.description.includes("<p>"), false);
});

test("synthesized prose that merely looks pointy is left alone", () => {
  // SwissDevJobs and a16z build their own plain-text descriptions; htmlToText
  // would eat a stack listing `<T>` or `<canvas>`.
  const r = intake(raw({ description: "Technologies: C#, Unity, <canvas>, generics <T>" }), NONE);
  assert.equal(r.unconverted, false);
  assert.ok(r.posting.description.includes("<canvas>"));
});

test("a date that parsed to nonsense degrades to unknown, it does not kill the run", () => {
  // One NaN Date took down a sweep slice.
  const r = intake(raw({ postedAt: new Date("not a date") }), NONE);
  assert.equal(r.posting.postedAt, undefined, "an unparseable date is simply absent");
  assert.equal(r.store, true, "date unknown is a posting, not a refusal");
});

test("the description scored is the description kept", () => {
  // Scoring the payload as it arrived rather than the assembled text is the
  // bug that collapsed enriched postings to a title-only score on every sweep.
  // "Head of People" has no engineering signal in its title on its own; the
  // assembled body cannot rescue that, and a body that never reached the
  // scorer could not be blamed for it either — so the falsifiable version is
  // the score itself.
  const flat = raw({ title: "Software Developer", description: "x" });
  const assembled = raw({
    title: "Software Developer",
    description: "x",
    sections: [["Requirements", "Unity, C#, shaders, rendering pipeline, gameplay"]],
  });
  const bare = scoreJob(flat).score;
  const rich = scoreJob(intake(assembled, NONE).posting).score;
  assert.ok(rich > bare, `the assembled body is what scored (${bare} -> ${rich})`);
});

test("the reading is handed back whole, so it cannot be half-applied", () => {
  // intake used to return the two repaired FIELDS, and the caller copied them
  // onto the raw job before deriving anything from it. That made the repair a
  // step someone could drop — and the loop that makes it is not callable, so
  // no test could have noticed. Everything downstream now takes `posting`.
  const job = raw({
    description: "<p>flat</p>",
    postedAt: new Date("not a date"),
    sections: [["Requirements", "Unity, C#"]],
  });
  const r = intake(job, NONE);
  assert.notEqual(r.posting, job, "a reading is not the payload");
  assert.equal(job.description, "<p>flat</p>", "and the payload is left as it arrived");
  assert.ok(r.posting.description.includes("Unity, C#"));
  assert.equal(r.posting.description.includes("<p>"), false);
  assert.equal(r.posting.postedAt, undefined);
  // Everything else about the posting survives untouched — the reading repairs
  // what it knows how to repair and copies the rest.
  for (const k of ["source", "externalId", "url", "title", "company", "location"] as const) {
    assert.equal(r.posting[k], job[k], k);
  }
});

// ── The gate has one home ─────────────────────────────────────────────────

// Every gate, against the TEMPLATE profile — the node test runner forces it
// (profilegen returns null under NODE_TEST_CONTEXT) so these do not read
// whichever personal profile happens to sit on the machine.
const GATED: ReadonlyArray<[string, Partial<RawJob>]> = [
  ["negative", { title: "Technical Recruiter" }],
  ["roleNegative", { title: "Game Designer" }],
  ["noSignal", { title: "Head of People" }],
  ["region", { location: "Tokyo, Japan" }],
  ["noMatch", { title: "Software Developer", description: "x" }],
  ["belowThreshold", { title: "QA Engineer" }],
];

test("each gate names itself, instead of being read out of its own prose", () => {
  // ingest used to recover these by matching prefixes of `reason`, so
  // rewording a message would silently rebucket the false-negative audit that
  // reads the counts.
  for (const [gate, over] of GATED) {
    assert.equal(rejectedBy(scoreJob(raw(over))), gate, JSON.stringify(over));
  }
  assert.equal(rejectedBy(scoreJob(raw())), null, "a real posting passes");
});

test("every gate is reachable, so no counter is quietly always zero", () => {
  // Six names in the report's census. A name nothing can produce reads as
  // "this never happens" when it means "this can never be counted".
  assert.equal(new Set(GATED.map(([g]) => g)).size, 6);
});

test("the store threshold is the gate's other half, and only this side knows it", () => {
  // A posting the scorer had no objection to can still land under the
  // threshold. That half is not the scorer's — the number lives with the other
  // derived fields — which is why the whole answer is assembled there rather
  // than in the caller that reports it.
  const passed = { ...scoreJob(raw()), gate: null } as Scored;
  assert.equal(rejectedBy({ ...passed, score: STORE_THRESHOLD }), null);
  assert.equal(rejectedBy({ ...passed, score: STORE_THRESHOLD - 1 }), "belowThreshold");
  // And a gate the scorer DID raise is not re-litigated against the number.
  assert.equal(rejectedBy({ ...passed, gate: "region", score: 0 }), "region");
});

test("rejected still means stored — the flag on the row IS this answer", () => {
  // Both halves of one rule: if these two ever disagree, a posting is live
  // below the gate an identical new one is rejected by. They used to be
  // written out twice.
  for (const [, over] of [["ok", {}] as const, ...GATED]) {
    const job = raw(over);
    const d = derivedFields(job, { country: "de", sponsorReg: false });
    assert.equal(d.disqualified, rejectedBy(scoreJob(job)) !== null, JSON.stringify(over));
  }
});
