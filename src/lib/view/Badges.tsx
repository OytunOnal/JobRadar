import type { Label } from "./labels";

// THE CHIPS A CARD WEARS, RENDERED ONCE.
//
// labels.ts decides WHAT a posting says about itself and what tone that claim
// carries; this is the other half, and it lived inside the radar page while
// the applications page wrote its own span with a different key and no shared
// shape. Two pages rendering one vocabulary two ways is how `sponsor✓` and
// `sponsor?` came to describe the same posting.
//
// The pages still choose WHICH labels they show — a tracker has no use for
// "may not be fresh" on a job you already applied to — and they choose by
// allow-list rather than by exclusion, so a new label kind has to be
// deliberately admitted to a surface instead of quietly appearing on all of
// them.
export function Badges({ labels }: { labels: Label[] }) {
  return (
    <>
      {labels.map((l) => (
        <span key={l.kind + l.text} className={`badge t-${l.tone}`} title={l.title}>
          {l.text}
        </span>
      ))}
    </>
  );
}
