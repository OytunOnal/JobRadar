import { countryPassesAccept, resolveCountry } from "./geo";
import { profile, type Track } from "./profile";
import type { RawJob } from "./sources/types";

export interface Scored {
  score: number; // 0-100
  track: Track;
  reason: string;
  scoredBy: "keyword";
  disqualified: boolean;
}

function countHits(haystack: string, needles: readonly string[]): string[] {
  return needles.filter((n) => haystack.includes(n.toLowerCase()));
}

function regionOk(job: RawJob): boolean {
  if (job.remote) return true;
  const loc = (job.location ?? "").toLowerCase();
  if (!loc) return true; // unknown location — don't discard, let score decide
  if (profile.acceptRegions.some((r) => loc.includes(r))) return true;
  // The substring list misses native spellings ("Frankfurt, Allemagne").
  // Resolve the country and let region grants in the list ("europe", "emea")
  // or country names decide.
  const country = resolveCountry(loc);
  return country !== null && countryPassesAccept(country, profile.acceptRegions);
}

// Deterministic keyword scorer. Picks the best-matching track and scores by how
// strongly the posting hits that track's vocabulary, with bonuses for remote and
// an explicit senior signal.
export function scoreJob(job: RawJob): Scored {
  const text = `${job.title}\n${job.description}`.toLowerCase();
  const title = job.title.toLowerCase();

  // Hard disqualifiers first.
  const negHit = countHits(text, profile.negative);
  if (negHit.length > 0) {
    return {
      score: 0,
      track: "other",
      reason: `Excluded (${negHit[0]})`,
      scoredBy: "keyword",
      disqualified: true,
    };
  }
  // Non-engineering role in the title (business dev, marketing, designer, ...).
  // EXCEPTION: a title-level match on one of the user's SPECIFIC tracks beats
  // a family negative — "LLM QA Engineer" belongs to the eval track even
  // though "qa " sits in the (unselected) QA family.
  const specificTitleMatch = profile.tracks.some((t) => {
    if (t.key.startsWith("general-")) return false;
    const vocab = t.searchVariants
      ? [...t.titleKeywords, ...Object.values(t.searchVariants).flat()]
      : t.titleKeywords;
    return countHits(title, vocab).length > 0;
  });
  const roleNeg = countHits(title, profile.roleNegatives);
  if (roleNeg.length > 0 && !specificTitleMatch) {
    return {
      score: 0,
      track: "other",
      reason: `Non-eng role (${roleNeg[0]})`,
      scoredBy: "keyword",
      disqualified: true,
    };
  }
  // A technical role must announce itself in the title.
  const hasRoleSignal = countHits(title, profile.roleSignals).length > 0;
  if (!hasRoleSignal) {
    return {
      score: 0,
      track: "other",
      reason: "No engineering role signal in title",
      scoredBy: "keyword",
      disqualified: true,
    };
  }
  if (!regionOk(job)) {
    return {
      score: 0,
      track: "other",
      reason: `Region mismatch (${job.location})`,
      scoredBy: "keyword",
      disqualified: true,
    };
  }

  let best = { track: "other" as Track, score: 0, reason: "No track match", titleHit: false };

  for (const t of profile.tracks) {
    // searchVariants carry the track's LOCAL-language titles
    // ("spieleentwickler", "programista gier") — they are title vocabulary,
    // not just search strings; without them local-titled postings could only
    // ever reach the body-only cap.
    const titleVocab = t.searchVariants
      ? [...t.titleKeywords, ...Object.values(t.searchVariants).flat()]
      : t.titleKeywords;
    const titleHits = countHits(title, titleVocab);
    const bodyHits = countHits(text, t.bodyKeywords);

    // Title match is the primary signal; body only supports it.
    let s = 0;
    s += titleHits.length * 40;
    s += Math.min(bodyHits.length, 5) * 5;

    if (s === 0) continue;

    // A body-only match (no track keyword in the title) is a weak signal —
    // cap it low so these sink beneath real title matches.
    const titleMatched = titleHits.length > 0;
    if (!titleMatched) s = Math.min(s, 22);

    // Bonuses (only meaningful once there's a real match)
    if (job.remote) s += 8;
    if (/\bsenior\b|\blead\b|\bstaff\b/.test(title)) s += 8;

    s = Math.min(100, s);

    // Prefer a higher score; break ties toward a title match and earlier track.
    const better = s > best.score || (s === best.score && titleMatched && !best.titleHit);
    if (better) {
      const hits = [...new Set([...titleHits, ...bodyHits])].slice(0, 5);
      const tag = titleMatched ? t.label : `${t.label} (body-only)`;
      best = { track: t.key, score: s, reason: `${tag}: ${hits.join(", ")}`, titleHit: titleMatched };
    }
  }

  return {
    score: best.score,
    track: best.track,
    reason: best.reason,
    scoredBy: "keyword",
    disqualified: best.score === 0,
  };
}
