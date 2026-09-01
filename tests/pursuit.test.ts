import test from "node:test";
import assert from "node:assert/strict";
import {
  transitionFields, pursuitEvent, followUpDate, ghostSuggested, followUpDue,
  FOLLOW_UP_DAYS, GHOST_SUGGEST_DAYS, HIRING_PAUSED_DAYS,
} from "../src/lib/queue/pursuit";
import { isConcluded } from "../src/lib/queue/pool";

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

// null CARRIES TWO MEANINGS in followUpAt — "never scheduled" and "the user
// pressed no-nudge" — and the first version of this module conflated them: any
// entry into an awaiting status re-armed the nudge, overriding an explicit
// opt-out, and an applied→new→applied undo silently deferred the date. Same
// disease the GPU lock's child field had: one field, two writers of meaning.
// The rule that untangles it: a follow-up date is absent only because someone
// decided so. Born at the first stamp and again when a finished pursuit is
// re-opened, dead at definitive ends, otherwise the user's to keep — including
// deliberately empty. Never absent by accident.

test("a cleared nudge survives a stage move — no-nudge means no nudge", () => {
  const { fields } = transitionFields(
    { status: "applied", appliedAt: NOW, followUpAt: null }, // user pressed "no nudge"
    "interview", { at: NOW });
  assert.equal(fields.followUpAt, null, "an opt-out is not a gap to fill");
});

test("an undo round-trip keeps the original nudge date", () => {
  const day10 = new Date(NOW.getTime() + FOLLOW_UP_DAYS * DAY);
  const toOpen = transitionFields(
    { status: "applied", appliedAt: NOW, followUpAt: day10 }, "interested", { at: NOW });
  assert.deepEqual(toOpen.fields.followUpAt, day10,
    "the fat-finger to open does not erase the schedule");
  const back = transitionFields(
    { status: "interested", appliedAt: NOW, followUpAt: day10 }, "applied",
    { at: new Date(NOW.getTime() + 2 * DAY) });
  assert.deepEqual(back.fields.followUpAt, day10, "and coming back does not defer it");
});

// This used to assert the opposite, and the justification it carried was "the
// follow-up buttons exist for exactly this decision". They no longer do: the
// nudge controls live in the nudge section, which a pursuit with no date can
// never enter. Under the old rule a rejection you re-opened sat awaiting a
// reply forever with nothing scheduled and no way to schedule it.
test("re-opening a concluded pursuit restarts its clock", () => {
  const { fields } = transitionFields(
    { status: "rejected", appliedAt: new Date(NOW.getTime() - 30 * DAY), followUpAt: null },
    "applied", { at: NOW });
  assert.equal(fields.appliedAt, undefined, "the original application date stands");
  assert.deepEqual(fields.followUpAt, new Date(NOW.getTime() + FOLLOW_UP_DAYS * DAY),
    "the ending cleared this date, so starting again restores it");
});

test("re-opening a dismissal restarts its clock too", () => {
  const { fields } = transitionFields(
    { status: "ignored", appliedAt: null, followUpAt: null }, "applied", { at: NOW });
  assert.deepEqual(fields.appliedAt, NOW);
  assert.deepEqual(fields.followUpAt, new Date(NOW.getTime() + FOLLOW_UP_DAYS * DAY));
});

// ── The employer's pause ─────────────────────────────────────────────────────

test("a hiring freeze nudges on the slower clock", () => {
  const soon = new Date(NOW.getTime() + 4 * DAY);
  const { fields } = transitionFields(
    { status: "applied", appliedAt: NOW, followUpAt: soon }, "stopped", { at: NOW });
  assert.deepEqual(fields.followUpAt, new Date(NOW.getTime() + HIRING_PAUSED_DAYS * DAY),
    "chasing a frozen req in four days asks a question nobody there can answer");
});

test("thawing puts the pursuit back on the fast clock", () => {
  const { fields } = transitionFields(
    { status: "stopped", appliedAt: NOW, followUpAt: new Date(NOW.getTime() + 30 * DAY) },
    "applied", { at: NOW });
  assert.deepEqual(fields.followUpAt, new Date(NOW.getTime() + FOLLOW_UP_DAYS * DAY),
    "a re-opened req is a live application again, not a month of patience");
});

test("a stage move within the same window still carries its date", () => {
  const chosen = new Date(NOW.getTime() + 2 * DAY);
  const { fields } = transitionFields(
    { status: "applied", appliedAt: NOW, followUpAt: chosen }, "interview", { at: NOW });
  assert.deepEqual(fields.followUpAt, chosen,
    "same window, so the date the user picked survives the move");
});

test("a silenced pursuit stays silent through a freeze", () => {
  const { fields } = transitionFields(
    { status: "applied", appliedAt: NOW, followUpAt: null }, "stopped", { at: NOW });
  assert.equal(fields.followUpAt, null, "a changed window is not a reason to overrule no-nudge");
});

test("a freeze is not an ending — no ghost suggestion, and the pursuit counts", () => {
  const longPast = new Date(NOW.getTime() - (GHOST_SUGGEST_DAYS + 5) * DAY);
  assert.equal(ghostSuggested({ status: "stopped", followUpAt: longPast }, NOW), false,
    "they did not go silent, they told you the req was frozen");
  assert.equal(followUpDue({ status: "stopped", followUpAt: longPast }, NOW), true,
    "and when the wait is up it is time to ask whether hiring resumed");
});

// THE INVARIANT, over every jump rather than the handful spelled out above.
// A pursuit awaiting a reply has a date, and there is exactly one way for it
// not to: it was already under way and someone silenced it. That is `no
// nudge`, which never changes status, so the state it leaves behind is
// recognisable — a stamped pursuit, no date, not coming from an ending.
//
// Every other arrival at an awaiting status schedules something. Without this
// the failure is invisible: nothing throws, the card simply never appears in
// the one section that could have offered it a date.
test("no transition strands an awaiting pursuit without a date", () => {
  const froms = ["new", "interested", "applied", "interview", "stopped", "offer", "rejected", "ghosted", "ignored"];
  const stamps = [null, new Date(NOW.getTime() - 30 * DAY)];
  const dates = [null, new Date(NOW.getTime() + 3 * DAY)];
  let silences = 0;
  for (const from of froms) {
    for (const appliedAt of stamps) {
      for (const followUpAt of dates) {
        for (const to of ["applied", "interview", "stopped"]) {
          const { fields } = transitionFields({ status: from, appliedAt, followUpAt }, to, { at: NOW });
          const ended = isConcluded(from) || from === "ignored";
          const where = `${from}→${to} (applied ${appliedAt ? "before" : "never"}, nudge ${followUpAt ? "set" : "none"})`;
          if (!ended && appliedAt && followUpAt === null) {
            silences++;
            assert.equal(fields.followUpAt, null, `${where} re-armed a nudge the user switched off`);
          } else {
            assert.notEqual(fields.followUpAt, null, `${where} left nothing scheduled`);
          }
        }
      }
    }
  }
  assert.equal(silences, 15, "the silenced case must actually occur, or this proves nothing");
});

test("recording an outside rejection still stamps the pursuit", () => {
  // Unreachable from today's buttons, constructible tomorrow: the user applied
  // outside the tool and only records the rejection. rejected is tracked, and
  // /applied sorts it by appliedAt — a null there renders as "applied —".
  const { fields } = transitionFields(open, "rejected", { at: NOW });
  assert.deepEqual(fields.appliedAt, NOW);
  assert.equal(fields.followUpAt, null);
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

test("followUpDate turns the form's choices into dates, and garbage into none", () => {
  assert.deepEqual(followUpDate("3", NOW), new Date(NOW.getTime() + 3 * DAY));
  assert.equal(followUpDate("clear", NOW), null);
  // A hand-crafted POST is not the UI. NaN would reach Prisma as Invalid Date
  // and come back as an unhandled 500; "could not parse" honestly means "no date".
  assert.equal(followUpDate("abc", NOW), null);
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
