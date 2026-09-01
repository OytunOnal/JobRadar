import { isVerdictStale, staleVerdictTitle } from "./labels";

// THE JUDGE'S NUMBER, IN ONE LINE, WHEREVER A TITLE NEEDS IT.
//
// Two surfaces already rendered this: the radar's starred strip and, in a
// different shape with a gauge, the main card. Adding the applications page by
// hand would have made a third copy of a rule that is not obvious — a verdict
// produced by a prompt we have replaced is FADED, not hidden, because the
// number is real but it is a different system's answer wearing the same
// column. That rule lives in labels.ts and is written five times in one file
// once already; this is the render half, so it gets a home too.
//
// The big gauge on the main card stays where it is. It is a different picture
// answering a different question — how strong, at a glance, in a list you are
// scanning — and flattening the two would be sameness for its own sake.
export function FitScore({
  job,
}: {
  job: { fitScore: number | null; fitVerdict: string | null; fitPromptVersion: string | null };
}) {
  if (job.fitScore == null) return null;
  const stale = isVerdictStale(job);
  return (
    <span
      className={`fitnum-inline v-${job.fitVerdict}${stale ? " verdict-stale" : ""}`}
      title={stale ? staleVerdictTitle(job) : undefined}
    >
      {job.fitScore}
    </span>
  );
}
