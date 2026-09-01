// WHERE THE WORK HAPPENS, read from the posting — and only where the posting
// actually says.
//
// Built against ground truth, not intuition: 1,502 Lever postings whose
// employers filled the ATS's own workplace dropdown, split by board so no
// company's house style straddles the line, plus a 705-posting holdout from 79
// boards no version of these rules was ever tuned on. What the measurements
// established:
//
//   * THE TEXT USUALLY DOESN'T SAY. 75% of stated-onsite postings and 54% of
//     stated-hybrid postings mention no arrangement in any form — employers
//     answer a dropdown, not their prose. No reader, human or model, can find
//     what was never written, so this detector's honest output is usually
//     null. The old rule's honest output should have been too: it answered
//     "onsite" instead and was right 46% of the time.
//
//   * POSITION BEATS VOCABULARY. When the arrangement is stated, it is stated
//     beside the location — "Barcelona - Hybrid", "Berlin Office (Hybrid)" —
//     or in the title. The same words deep in the body are usually about
//     something else: hybrid search, hybrid cloud, hybrid casual, "we are a
//     remote-first company" above a role the employer filed as onsite
//     (Ovoko's seven Vilnius postings, all opening with the same paragraph).
//     Location+title rules held 95-100% on the holdout; body rules did not
//     (a "N days in office" rule went 8/8 on the tuning data and 2/8 fresh —
//     that is what an n=8 rule is worth).
//
//   * A LOCATION OFFERING A CHOICE ISN'T STATING AN ARRANGEMENT. "San
//     Francisco OR Remote" names what is negotiable; employers file those
//     under hybrid as often as remote. Such fields are skipped, not read.
//
// The one body rule kept is remote-only set phrases ("fully remote", "work
// from anywhere"): remote is the one arrangement postings actually announce
// in prose (65% of stated-remote do), and the phrases are unambiguous in a
// way the bare words are not.
//
// This module never returns "unknown" — null means it has nothing to say, and
// the caller decides what silence becomes. It speaks on roughly a sixth of
// postings and is right ~95% of the time when it does; deriveWorkMode's
// layering (source > this > llm) does the rest.

import type { WorkMode } from "../sources/types";

const HYBRID_WORD = /\bhybrid\b|\bhybride\b|\bhíbrido\b/i;
const REMOTE_WORD =
  /\bremote\b|\bwork from (home|anywhere)\b|\bwfh\b|\bhome[- ]?office\b|\bteletrabajo\b|\btélétravail\b/i;
const ONSITE_WORD =
  /\bon[- ]?site\b|\bin[- ]person\b|\bvor ort\b|\bpresencial\b|\bin (the|our) office\b/i;

// A remote word being used to rule remote out: "not remote", "non-remote",
// "not a fully remote role". The optional article and intensifier are what the
// first version missed — "not a FULLY remote role" contains "fully remote",
// which is one of the trusted set phrases, so the negation guard has to reach
// at least as far as the phrases it guards.
const NOT_REMOTE =
  /\b(no|not|non)[- ](a )?(fully |100% |entirely )?remote\b|\bremote work is not\b/i;

// A field naming alternatives rather than an arrangement.
const CHOICE = /\b(or|and)\b|[/|]/i;

// Remote-only set phrases a body can be trusted on. Deliberately NOT the bare
// word, and deliberately not "remote-first" — that is a claim about the
// company, not about this role.
const REMOTE_PHRASE =
  /\b(fully|100%|entirely) remote\b|\bwork from anywhere\b|\bthis (is|role is) (a )?(fully )?remote\b/i;

function inField(field: string): WorkMode | null {
  if (HYBRID_WORD.test(field)) return "hybrid";
  if (NOT_REMOTE.test(field)) return null;
  if (REMOTE_WORD.test(field)) return "remote";
  if (ONSITE_WORD.test(field)) return "onsite";
  return null;
}

/** What the posting text states about its arrangement, or null when it is
 * silent — which is most of the time, and is an answer, not a failure. */
export function detectWorkMode(
  title: string,
  location: string | null | undefined,
  description: string,
): WorkMode | null {
  const loc = location ?? "";
  // A choice is only a choice when remote is one of the options: "Berlin and
  // Munich" narrows nothing about the arrangement of either.
  if (!(CHOICE.test(loc) && /remote/i.test(loc))) {
    const fromLoc = inField(loc);
    if (fromLoc) return fromLoc;
  }
  const fromTitle = inField(title);
  if (fromTitle) return fromTitle;

  const body = description.slice(0, 3000);
  if (REMOTE_PHRASE.test(body) && !NOT_REMOTE.test(body)) return "remote";
  return null;
}
