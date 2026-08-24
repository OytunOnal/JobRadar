// Dismiss reasons: one click each, stored on the job. Beyond bookkeeping they
// are labeled feedback — a pile of "language" dismissals is the order form for
// automatic language-requirement detection.
export const DISMISS_REASONS: Array<{ key: string; label: string }> = [
  { key: "language", label: "Language requirement" },
  { key: "seniority", label: "Seniority mismatch" },
  { key: "stack", label: "Not my stack" },
  { key: "company-applied", label: "Already applied to company" },
  { key: "company", label: "Not this company" },
  { key: "terms", label: "Weak terms / salary" },
  { key: "no-visa", label: "No visa sponsorship" },
  { key: "ghost", label: "Ghost / suspicious" },
];

export function reasonLabel(key: string | null): string {
  return DISMISS_REASONS.find((r) => r.key === key)?.label ?? "No reason";
}
