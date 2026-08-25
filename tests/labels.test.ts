import test from "node:test";
import assert from "node:assert/strict";
import {
  postingLabels, isVerdictStale, staleVerdictTitle,
  VISA_LABELS, VISA_TIERS, type LabelledPosting,
} from "../src/lib/view/labels";
import { FIT_PROMPT_VERSION } from "../src/lib/llm/fit";
import { languageBarriers, profile } from "../src/lib/user/profile";

// Every one of these rules used to be a ternary inside JSX, in 1,682 lines of
// src/app that no test imported. Three of them had already been copied into
// other files, where they drifted.

const NOW = new Date("2026-08-24T12:00:00Z");

function posting(over: Partial<LabelledPosting> = {}): LabelledPosting {
  return {
    title: "Senior Unity Developer", company: "Acme", source: "gh:acme",
    track: "unity", workMode: "onsite", langReq: null, visaTier: "unknown",
    ghostRisk: false, fitCategory: null, fitVerdict: "strong",
    fitPromptVersion: FIT_PROMPT_VERSION,
    postedAt: new Date("2026-08-20T00:00:00Z"),
    firstSeenAt: new Date("2026-08-20T00:00:00Z"),
    lastSeenAt: NOW,
    delistedAt: null,
    ...over,
  };
}

const kinds = (p: LabelledPosting, ctx = {}) => postingLabels(p, { now: NOW, ...ctx }).map((l) => l.kind);
const find = (p: LabelledPosting, kind: string, ctx = {}) =>
  postingLabels(p, { now: NOW, ...ctx }).find((l) => l.kind === kind);

test("a verdict is stale when a different prompt produced it", () => {
  assert.equal(isVerdictStale({ fitPromptVersion: FIT_PROMPT_VERSION }), false);
  assert.equal(isVerdictStale({ fitPromptVersion: "v3-old" }), true);
  // Never judged at all is also not current.
  assert.equal(isVerdictStale({ fitPromptVersion: null }), true);
  assert.ok(staleVerdictTitle({ fitPromptVersion: "v3-old" }).includes("v3-old"));
  assert.ok(staleVerdictTitle({ fitPromptVersion: "v3-old" }).includes(FIT_PROMPT_VERSION));
});

// All five tiers speak. Silence used to mean two opposite things — "nobody has
// said" and "the posting explicitly rules it out" — on 1,323 postings.
test("every visa tier that has an answer produces a label", () => {
  assert.equal(find(posting({ visaTier: "yes" }), "visa")?.text, "sponsor✓");
  assert.equal(find(posting({ visaTier: "maybe" }), "visa")?.text, "sponsor?");
  assert.equal(find(posting({ visaTier: "no" }), "visa")?.text, "no sponsorship");
  assert.equal(find(posting({ visaTier: "not-needed" }), "visa")?.text, "no visa needed");
  // Only genuine absence of an answer is silent.
  assert.equal(find(posting({ visaTier: "unknown" }), "visa"), undefined);
});

test("the visa tiers carry the tone their evidence supports", () => {
  assert.equal(find(posting({ visaTier: "yes" }), "visa")?.tone, "good");
  assert.equal(find(posting({ visaTier: "not-needed" }), "visa")?.tone, "good");
  assert.equal(find(posting({ visaTier: "no" }), "visa")?.tone, "risk");
  // A register match says the company CAN sponsor, not that it will for this
  // role. Rendering that as sponsor✓ over-promised on 1,920 postings.
  assert.equal(find(posting({ visaTier: "maybe" }), "visa")?.tone, "note");
});

test("a delisted posting says so once, and does not also say it may be stale", () => {
  const gone = posting({ delistedAt: new Date("2026-08-22T00:00:00Z") });
  assert.deepEqual(kinds(gone).filter((k) => k === "delisted" || k === "freshness"), ["delisted"]);
  assert.equal(find(gone, "delisted")?.tone, "risk");
});

test("an old posting is disclosed, never hidden", () => {
  const old = posting({
    postedAt: new Date("2025-01-01T00:00:00Z"),
    firstSeenAt: new Date("2025-01-01T00:00:00Z"),
  });
  const fresh = find(old, "freshness");
  assert.ok(fresh, "an evergreen posting carries the badge");
  assert.equal(fresh!.text, "may not be fresh");
  assert.equal(fresh!.tone, "risk");
  // ADR-9: the posting itself is still in the list; only the label appears.
});

test("ghost risk is the model's reading, surfaced as a risk", () => {
  assert.equal(find(posting({ ghostRisk: true }), "ghost-risk")?.tone, "risk");
  assert.equal(find(posting({ ghostRisk: false }), "ghost-risk"), undefined);
});

test("a language the profile does not cover is a barrier; one it covers is not", () => {
  const mine = profile.languages[0] ?? "en";
  assert.deepEqual(languageBarriers(mine), [], "your own language is never a barrier");
  assert.deepEqual(languageBarriers("zz"), ["zz"]);
  assert.deepEqual(languageBarriers(null), []);

  const label = find(posting({ langReq: "zz" }), "language");
  assert.ok(label?.text.startsWith("requires "));
  assert.equal(label?.tone, "risk");
  assert.equal(find(posting({ langReq: mine }), "language"), undefined);
});

test("plain facts are notes, not risks", () => {
  assert.equal(find(posting({ track: "unity" }), "track")?.tone, "note");
  assert.equal(find(posting({ workMode: "remote" }), "work-mode")?.text, "remote");
  // onsite is the default and says nothing worth a badge.
  assert.equal(find(posting({ workMode: "onsite" }), "work-mode"), undefined);
});

test("the fit category explains a cap, but only when it says something", () => {
  assert.equal(find(posting({ fitCategory: "NO_VISA" }), "fit-category")?.text, "no visa");
  assert.equal(find(posting({ fitCategory: "NONE" }), "fit-category"), undefined);
  assert.equal(find(posting({ fitCategory: "OTHER" }), "fit-category"), undefined);
});

test("an application in progress at the company is good news", () => {
  const ctx = { appliedCompanies: new Set(["Acme"]) };
  assert.equal(find(posting(), "applied-at-company", ctx)?.tone, "good");
  assert.equal(find(posting({ company: "Other" }), "applied-at-company", ctx), undefined);
});

// The freshness reading is measured against the pool's own clock, so a pause in
// ingesting never retires the pool.
test("delisting is judged against the pool's clock, not the wall clock", () => {
  const lagging = posting({
    source: "gh:acme", // a direct source: absence means something
    lastSeenAt: new Date("2026-07-01T00:00:00Z"),
  });
  const poolMovedOn = { poolNewest: NOW };
  const poolAlsoStale = { poolNewest: new Date("2026-07-02T00:00:00Z") };
  assert.ok(kinds(lagging, poolMovedOn).includes("delisted"));
  assert.equal(kinds(lagging, poolAlsoStale).includes("delisted"), false);
});

// ── One vocabulary, two surfaces ──────────────────────────────────────────

test("every tier a URL may name has a chip, and it comes from the card's record", () => {
  // The filter bar used to name the tiers itself: `visa: yes` where the card
  // said sponsor✓, and `visa: no` (you are ruled out) sitting immediately
  // beside `no visa needed` (nothing to worry about). Two modules, one fact.
  for (const tier of VISA_TIERS) {
    const label = VISA_LABELS[tier];
    assert.ok(label, `${tier} has no label at all`);
    assert.ok(label.chip.trim().length > 0, `${tier} has a blank chip`);
  }
  const chips = VISA_TIERS.map((t) => VISA_LABELS[t].chip);
  assert.equal(new Set(chips).size, chips.length, "two tiers cannot share a chip");
});

test("no chip reads as the opposite of what it means", () => {
  // The two the rename was for. "visa: yes" was the good news and read as
  // "a visa is required"; "visa: no" was the bad news and sat next to
  // "no visa needed", which is the best news there is.
  assert.equal(VISA_LABELS.yes.chip, "sponsors");
  assert.equal(VISA_LABELS.maybe.chip, "can sponsor");
  assert.equal(VISA_LABELS.no.chip, "no sponsorship");
  assert.equal(VISA_LABELS.unknown.chip, "not stated");
  assert.equal(VISA_LABELS["not-needed"].chip, "no visa needed");
  for (const tier of VISA_TIERS) {
    assert.equal(VISA_LABELS[tier].chip.startsWith("visa:"), false,
      `${tier} still names the document instead of the answer`);
  }
});

test("silence on a card is a decision, and only unknown gets it", () => {
  // Every other tier speaks, because silence used to mean both "nobody said"
  // and "explicitly refused" on 1,323 postings.
  assert.equal(VISA_LABELS.unknown.badge, undefined);
  for (const tier of VISA_TIERS.filter((t) => t !== "unknown")) {
    assert.ok(VISA_LABELS[tier].badge, `${tier} says nothing on a card`);
  }
});

test("the badge a card shows is the badge in the record — not a second table", () => {
  for (const tier of VISA_TIERS) {
    const badge = VISA_LABELS[tier].badge;
    const shown = find(posting({ visaTier: tier }), "visa");
    assert.equal(shown?.text, badge?.text, tier);
    assert.equal(shown?.tone, badge?.tone, tier);
  }
});
