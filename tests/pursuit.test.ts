import test from "node:test";
import assert from "node:assert/strict";
import {
  transitionFields, pursuitEvent, followUpDate, ghostSuggested, followUpDue,
  FOLLOW_UP_DAYS, GHOST_SUGGEST_DAYS,
} from "../src/lib/queue/pursuit";

// The write side of the pursuit lifecycle, tested for the first time. The read
// side (pool.ts) always had tests; the rules that PRODUCE the statuses lived in
// form handlers and a render function, and their one invariant was enforced
// only on read. Everything here drives the pure interface — no DB, no React.

const NOW = new Date("2026-08-25T12:00:00Z");
const DAY = 86_400_000;

const open = { status: "new", appliedAt: null, followUpAt: null };

test("first entry into applied stamps the application and schedules the nudge", () => {
  const { fields } = transitionFields(open, "applied", { at: NOW });
  assert.equal(fields.status, "applied");
  assert.deepEqual(fields.appliedAt, NOW);
  assert.deepEqual(fields.followUpAt, new Date(NOW.getTime() + FOLLOW_UP_DAYS * DAY));
});

test("re-entering applied re-stamps nothing", () => {
  const earlier = new Date(NOW.getTime() - 5 * DAY);
  const nudge = new Date(NOW.getTime() + 5 * DAY);
  const { fields } = transitionFields(
    { status: "interview", appliedAt: earlier, followUpAt: nudge }, "applied", { at: NOW });
  assert.equal(fields.appliedAt, undefined, "the original application date stands");
  assert.deepEqual(fields.followUpAt, nudge, "and the scheduled nudge is not moved");
});

// The ADR-12 case: a pursuit tracked late. Under the old partial rules the
// stamp and the nudge only happened on the exact "applied" jump, so a posting
// entering at interview never engaged the follow-up machinery at all — and the
// ghost suggestion, which keys on the nudge date, could never fire for it.
test("tracking a pursuit late still engages the whole lifecycle", () => {
  const { fields } = transitionFields(open, "interview", { at: NOW });
  assert.deepEqual(fields.appliedAt, NOW, "they did apply, even if we saw it late");
  assert.deepEqual(fields.followUpAt, new Date(NOW.getTime() + FOLLOW_UP_DAYS * DAY));
});

test("entering straight at offer stamps the pursuit but schedules no nudge", () => {
  const { fields } = transitionFields(open, "offer", { at: NOW });
  assert.deepEqual(fields.appliedAt, NOW);
  assert.equal(fields.followUpAt, null, "a concluded pursuit needs no nudging");
});

test("concluding clears the nudge", () => {
  const { fields } = transitionFields(
    { status: "applied", appliedAt: NOW, followUpAt: new Date(NOW.getTime() + DAY) },
    "rejected", { at: NOW });
  assert.equal(fields.followUpAt, null);
});

// The invariant that used to be one-way: dismissing left followUpAt behind and
// /applied compensated with a status guard on read. Now the write side agrees.
test("dismissing clears the nudge and records why", () => {
  const { fields, event } = transitionFields(
    { status: "applied", appliedAt: NOW, followUpAt: new Date(NOW.getTime() + DAY) },
    "ignored", { reason: "visa-hopeless", at: NOW });
  assert.equal(fields.followUpAt, null, "the write side enforces it now");
  assert.equal(fields.dismissReason, "visa-hopeless");
  assert.equal(event.type, "dismissed");
  assert.deepEqual(JSON.parse(event.payload!), { to: "ignored", reason: "visa-hopeless" });
});

test("leaving dismissal clears the reason", () => {
  const { fields } = transitionFields(
    { status: "ignored", appliedAt: null, followUpAt: null }, "interested", { at: NOW });
  assert.equal(fields.dismissReason, null);
});

test("undoing back to open keeps the history but stops the nudging", () => {
  const { fields } = transitionFields(
    { status: "applied", appliedAt: NOW, followUpAt: new Date(NOW.getTime() + DAY) },
    "interested", { at: NOW });
  assert.equal(fields.appliedAt, undefined, "what happened, happened");
  assert.equal(fields.followUpAt, null, "but an open posting is not awaiting a reply");
});

test("reopening a concluded pursuit re-arms the nudge", () => {
  const { fields } = transitionFields(
    { status: "rejected", appliedAt: new Date(NOW.getTime() - 30 * DAY), followUpAt: null },
    "applied", { at: NOW });
  assert.equal(fields.appliedAt, undefined);
  assert.deepEqual(fields.followUpAt, new Date(NOW.getTime() + FOLLOW_UP_DAYS * DAY));
});

test("one event shape for single and bulk, and bulk says so", () => {
  const single = transitionFields(open, "ignored", { reason: "company-applied", at: NOW }).event;
  const bulk = transitionFields(open, "ignored", { reason: "company-applied", bulk: true, at: NOW }).event;
  assert.equal(single.type, bulk.type);
  assert.deepEqual(JSON.parse(bulk.payload!), { to: "ignored", reason: "company-applied", bulk: true });
  const plain = transitionFields(open, "interested", { at: NOW }).event;
  assert.equal(plain.type, "status-change");
});

test("pursuitEvent is the one way an action-log row is shaped", () => {
  const e = pursuitEvent("note", null, NOW);
  assert.deepEqual(e, { type: "note", payload: null, at: NOW });
});

test("followUpDate turns the form's choices into dates", () => {
  assert.deepEqual(followUpDate("3", NOW), new Date(NOW.getTime() + 3 * DAY));
  assert.equal(followUpDate("clear", NOW), null);
});

test("the ghost suggestion fires at fourteen days of silence, not thirteen", () => {
  const at = (days: number) => ({
    status: "applied",
    followUpAt: new Date(NOW.getTime() - days * DAY),
  });
  assert.equal(ghostSuggested(at(GHOST_SUGGEST_DAYS + 1), NOW), true);
  assert.equal(ghostSuggested(at(GHOST_SUGGEST_DAYS - 1), NOW), false);
  assert.equal(ghostSuggested({ ...at(GHOST_SUGGEST_DAYS + 1), status: "interview" }, NOW), false);
  assert.equal(ghostSuggested({ status: "applied", followUpAt: null }, NOW), false);
});

test("a follow-up is due only while a reply is awaited", () => {
  const past = new Date(NOW.getTime() - DAY);
  assert.equal(followUpDue({ status: "applied", followUpAt: past }, NOW), true);
  assert.equal(followUpDue({ status: "interview", followUpAt: past }, NOW), true);
  assert.equal(followUpDue({ status: "ignored", followUpAt: past }, NOW), false);
  assert.equal(followUpDue({ status: "applied", followUpAt: new Date(NOW.getTime() + DAY) }, NOW), false);
});
