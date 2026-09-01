// WHAT A POSTING'S CARD SAYS ABOUT IT.
//
// Every one of these decisions used to live inside JSX. That is not a style
// complaint: a rule written as a ternary in a tree cannot be called, so it
// cannot be tested, and three of them had already been copied to other files
// where they drifted. The census that prompted this module found, in 1,682
// lines of src/app with zero tests:
//
//   * the same posting rendering `sponsor✓` on one surface and `sponsor?` on
//     another, because the two read different columns for the same idea —
//     1,920 live postings in that state;
//   * "gone from the source" written twice, as `delisted` on the radar (the
//     broad, tested classifier) and `⚠ posting closed` on /applied (a bare
//     column read), so a posting could show one and not the other;
//   * the stale-verdict rule written five times in one file, with two different
//     tooltips and a suffix that only one of them applies;
//   * the language-barrier filter copied byte-for-byte into three files;
//   * three of the five visa tiers rendering nothing at all, so "we don't know"
//     and "explicitly refused" looked identical — 1,323 postings.
//
// A label carries MEANING, not placement: `tone` says whether this is a risk, a
// note, or good news, and the page decides what colour that is and where it
// goes. Putting the slot in the data would mean editing a rules module to move
// a badge, which is the wrong cable.

import { classifyFreshness, ageLabel, type Freshness } from "../scoring/freshness";
import { languageBarriers } from "../user/profile";
import { LANG_NAMES } from "../scoring/langreq";
import { FIT_PROMPT_VERSION } from "../llm/fit";
import { VISA_TIERS, type VisaTier } from "../visa/visa";

export { VISA_TIERS, type VisaTier };

export type LabelTone = "risk" | "note" | "good";

export interface Label {
  kind: string;
  text: string;
  tone: LabelTone;
  title?: string;
}

// What a posting is, as far as a card is concerned. Deliberately structural
// rather than the Prisma type: these functions are pure and a test builds one
// by hand.
export interface LabelledPosting {
  title: string;
  company: string;
  source: string;
  track: string | null;
  workMode: string;
  langReq: string | null;
  visaTier: string;
  ghostRisk: boolean;
  fitCategory: string | null;
  fitVerdict: string | null;
  fitPromptVersion: string | null;
  postedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  delistedAt: Date | null;
}

export interface LabelContext {
  now?: Date;
  // How far the newest observation across the whole pool has advanced. The
  // delisted test is measured against it rather than wall-clock time, so a
  // pause in ingesting never ages the pool.
  poolNewest?: Date;
  // Companies the user already has an application in progress at.
  appliedCompanies?: ReadonlySet<string>;
}

// A verdict produced by a prompt we have replaced is not wrong, it is a
// different system's answer wearing the same column. The radar fades it rather
// than hiding it — the number is real — and this is the one rule that decides
// so. It used to be written five times in one file, twice with different
// tooltips and once as a " · old" suffix that only the main card applied.
export function isVerdictStale(job: { fitPromptVersion: string | null }): boolean {
  return job.fitPromptVersion !== FIT_PROMPT_VERSION;
}

export function staleVerdictTitle(job: { fitPromptVersion: string | null }): string {
  return `Judged by an older version (${job.fitPromptVersion ?? "?"}) on text we have since repaired — waiting to be re-judged by ${FIT_PROMPT_VERSION}.`;
}

// ONE RECORD PER TIER, AND BOTH SURFACES READ IT.
//
// Silence used to mean two opposite things on a card — "nobody has said" and
// "the posting rules it out" — so `no` speaks now, and silence means exactly
// one thing. But the FILTER BAR was never brought under this module: it named
// the tiers itself, in its own words, and put `visa: no` (you are ruled out)
// immediately beside `no visa needed` (nothing to worry about), while calling
// the good news `visa: yes` — which most readers hear as "a visa is required".
//
// A card and a chip want different lengths of the same sentence: a card is
// scanned in a dense list, a chip has to explain itself to someone who has
// never seen the app. That is not two spellings. Two spellings was two
// MODULES disagreeing; this is one record with two renderings, declared on
// the same line so they cannot drift, and keyed by VisaTier so a new tier
// without a name is a compile error rather than a blank chip.
//
// Everything reads visaTier, never sponsorReg. They are not the same claim: a
// company holding a sponsor licence is evidence that it CAN sponsor, which
// deriveVisaTier maps to "maybe", and rendering that as sponsor✓ promised more
// than the evidence supports on 1,920 postings.
export interface VisaTierLabel {
  /** What a card shows — absent where the card deliberately says nothing. */
  badge?: Label;
  /** What the filter chip shows. Every tier is filterable, so every tier has one. */
  chip: string;
}

export const VISA_LABELS: Record<VisaTier, VisaTierLabel> = {
  yes: {
    chip: "sponsors",
    badge: {
      kind: "visa", text: "sponsor✓", tone: "good",
      title: "The posting itself states it sponsors visas / offers relocation.",
    },
  },
  maybe: {
    chip: "can sponsor",
    badge: {
      kind: "visa", text: "sponsor?", tone: "note",
      title: "The posting is silent, but the company is listed in its country's public sponsor register (NL IND / UK Home Office / DK SIRI / IE DETE) — it CAN sponsor.",
    },
  },
  no: {
    chip: "no sponsorship",
    badge: {
      kind: "visa", text: "no sponsorship", tone: "risk",
      title: "The posting explicitly rules sponsorship out, or requires an existing right to work.",
    },
  },
  unknown: {
    // No badge on purpose. Now that `no` speaks, a card saying nothing about
    // sponsorship can only mean nobody has said — which is the honest
    // majority and does not need a word taking up room in a dense list. A
    // filter still has to name it, because you can filter FOR silence.
    chip: "not stated",
  },
  "not-needed": {
    chip: "no visa needed",
    badge: {
      kind: "visa", text: "no visa needed", tone: "good",
      title: "You already have the right to work in this job's country — sponsorship is not a factor.",
    },
  },
};

export function postingLabels(job: LabelledPosting, ctx: LabelContext = {}): Label[] {
  const now = ctx.now ?? new Date();
  const labels: Label[] = [];
  const freshness: Freshness = classifyFreshness(job, now, ctx.poolNewest);

  // ── Risks, disclosed rather than hidden (ADR-9) ────────────────────────
  if (freshness === "delisted") {
    labels.push({
      kind: "delisted", text: "posting closed", tone: "risk",
      title: "The posting was taken down at its source — the role may be filled or closed.",
    });
  } else if (freshness === "aging" || freshness === "evergreen") {
    // Not hidden, because the date is the least reliable thing a source tells
    // us: Ashby reported a still-open role as published in 2021 because the
    // field records when the record was created. Disclosed instead.
    labels.push({
      kind: "freshness", text: "may not be fresh", tone: "risk",
      title: `The source dates this posting ${ageLabel(job.postedAt ?? job.firstSeenAt, now)} ago. Source dates are unreliable on evergreen boards — we still see it listed.`,
    });
  }

  if (job.ghostRisk) {
    labels.push({
      kind: "ghost-risk", text: "ghost risk", tone: "risk",
      title: "The model read this posting and thought it may not be one real, active opening — talent-pool voice, an agency advertising an unnamed employer, or contradictory requirements.",
    });
  }

  // ── Visa: all five tiers, one column ──────────────────────────────────
  const visa = VISA_LABELS[job.visaTier as VisaTier]?.badge;
  if (visa) labels.push(visa);

  // ── Barriers the user cares about ─────────────────────────────────────
  const barriers = languageBarriers(job.langReq);
  if (barriers.length > 0) {
    labels.push({
      kind: "language",
      text: `requires ${barriers.map((c) => LANG_NAMES[c] ?? c).join("/")}`,
      tone: "risk",
      title: "The description appears to require a language outside your profile — verify before applying.",
    });
  }

  if (job.fitCategory && job.fitCategory !== "NONE" && job.fitCategory !== "OTHER") {
    labels.push({
      kind: "fit-category",
      text: job.fitCategory.toLowerCase().replace("_", " "),
      tone: "note",
      title: "Why the judge capped this posting.",
    });
  }

  // ── Plain facts ───────────────────────────────────────────────────────
  if (job.track) labels.push({ kind: "track", text: job.track, tone: "note" });
  // Every KNOWN mode speaks, onsite included — silence is reserved for
  // "nobody said". Until the unknown value existed this line hid onsite,
  // because onsite was the default and showing it would have stamped a guess
  // on ~45k cards; now a card saying onsite means the employer or the text
  // actually said so.
  if (job.workMode !== "unknown") labels.push({ kind: "work-mode", text: job.workMode, tone: "note" });

  if (ctx.appliedCompanies?.has(job.company)) {
    labels.push({
      kind: "applied-at-company", text: "applied@co", tone: "good",
      title: "You have an application in progress at this company.",
    });
  }

  return labels;
}
