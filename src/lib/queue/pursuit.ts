import { DISMISSED_STATUS, TRACKED_STATUSES, isAwaitingReply, isConcluded } from "./pool";

// THE WRITE SIDE OF THE PURSUIT LIFECYCLE. pool.ts answers what a status
// means; this module answers what changing one does. Until it existed, that
// second answer was spread over two form handlers and a render function — one
// policy, three files, zero tests — and its single invariant was enforced only
// on read: dismissing left the nudge date behind and /applied compensated with
// a status guard. See ADR-12.
//
// EFFECTS, NOT PERMISSIONS. Any status may follow any status: this is a
// local-first tool, the user is the authority over their own pursuit data, and
// `applied → new` is almost always an undo rather than an error. The price of
// refusing nothing is that every jump must mean something — including the ones
// a single-user tool never showed us, like tracking a pursuit late, straight
// into interview or offer. Under the old partial rules such a pursuit never
// engaged the follow-up machinery at all.

/** First nudge, this many days after applying. Europe answers slowly. */
export const FOLLOW_UP_DAYS = 10;
/** A nudge this long overdue and still silent probably means ghosted. */
export const GHOST_SUGGEST_DAYS = 14;

const DAY = 86_400_000;

export interface PursuitState {
  status: string;
  appliedAt: Date | null;
  followUpAt: Date | null;
}

/** One action-log row. The ONLY shape one is written in — there used to be
 * two: a nested create with a stringified payload, and a bulk createMany with
 * a hand-assembled JSON string. Same event, two spellings. */
export interface PursuitEvent {
  type: string;
  payload: string | null;
  at: Date;
}

export function pursuitEvent(
  type: string,
  payload: Record<string, unknown> | null,
  at: Date = new Date(),
): PursuitEvent {
  return { type, payload: payload === null ? null : JSON.stringify(payload), at };
}

export interface TransitionOptions {
  /** Why, when dismissing. ADR-5: this is the system's most valuable labeled data. */
  reason?: string | null;
  /** Part of a company-wide sweep rather than a single decision. */
  bulk?: boolean;
  at?: Date;
}

/**
 * Everything a status change writes: the fields for the row, and the event for
 * the log. Pure — the caller applies both. `appliedAt` is present only when it
 * is being stamped; absent means untouched, which is how the spread pattern
 * says "what happened, happened".
 *
 * The rules are TOTAL over every jump:
 * - entering any tracked status stamps `appliedAt` if it was never set — a
 *   pursuit tracked late still gets its stamp, and so does one recorded only
 *   at its rejection;
 * - THE NUDGE RIDES THE STAMP: a follow-up date is born when the pursuit is
 *   first stamped into an awaiting status, dies at definitive ends (concluded,
 *   dismissed), and is otherwise the user's to keep — including deliberately
 *   empty. The first version of this rule filled every null on entering an
 *   awaiting status, and null carries two meanings here: "never scheduled"
 *   and "the user pressed no-nudge". Filling both re-armed an explicit
 *   opt-out and let an applied→new→applied undo silently defer the date —
 *   one field, two meanings, the same disease the GPU lock's child field had;
 * - dismissing records the reason; every other entry clears it.
 */
export function transitionFields(
  current: PursuitState,
  to: string,
  opts: TransitionOptions = {},
): { fields: {
  status: string;
  appliedAt?: Date;
  followUpAt: Date | null;
  dismissReason: string | null;
}; event: PursuitEvent } {
  const at = opts.at ?? new Date();
  const stamping = (TRACKED_STATUSES as readonly string[]).includes(to) && !current.appliedAt;
  const dismissed = to === DISMISSED_STATUS;
  const reason = dismissed ? (opts.reason || null) : null;

  return {
    fields: {
      status: to,
      ...(stamping ? { appliedAt: at } : {}),
      followUpAt: isConcluded(to) || dismissed
        ? null
        : stamping && isAwaitingReply(to)
          ? new Date(at.getTime() + FOLLOW_UP_DAYS * DAY)
          : current.followUpAt,
      dismissReason: reason,
    },
    event: pursuitEvent(
      dismissed ? "dismissed" : "status-change",
      { to, ...(reason ? { reason } : {}), ...(opts.bulk ? { bulk: true } : {}) },
      at,
    ),
  };
}

/** The manual follow-up form's choices: a number of days, or "clear". What
 * cannot be parsed honestly means "no date" — NaN would travel to Prisma as an
 * Invalid Date and come back as an unhandled 500. */
export function followUpDate(days: string, at: Date = new Date()): Date | null {
  const n = Number(days);
  return days === "clear" || !Number.isFinite(n) ? null : new Date(at.getTime() + n * DAY);
}

/** Nudge long overdue and still no answer — probably ghosted. Applied only:
 * an interview-stage silence is a different conversation to give up on. */
export function ghostSuggested(
  j: { status: string; followUpAt: Date | null },
  now: Date = new Date(),
): boolean {
  return j.status === "applied"
    && j.followUpAt !== null
    && now.getTime() - j.followUpAt.getTime() > GHOST_SUGGEST_DAYS * DAY;
}

/** Time to nudge: the date has arrived and a reply is still awaited. */
export function followUpDue(
  j: { status: string; followUpAt: Date | null },
  now: Date = new Date(),
): boolean {
  return isAwaitingReply(j.status)
    && j.followUpAt !== null
    && j.followUpAt.getTime() <= now.getTime();
}
