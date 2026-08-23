// The unit of work the pipeline advances in: a score range holding roughly
// CHUNK_TARGET postings.
//
// WHY CHUNK AT ALL, when the blend already orders everything? Because the
// blend can only rank what has a vector, and vectors cost GPU time that would
// otherwise be judging. Embedding all 27k pending postings before the first
// judgment is ~18 minutes of nothing visibly happening; embedding one chunk
// is ~40 seconds. Measured, gating this way costs nothing at the top: of the
// blend's best 500 postings across the whole pool, ZERO fell outside the 80+
// band.
//
// WHY BY COUNT AND NOT BY A FIXED SCORE STEP. Fixed 5-point bands sized
// between 176 and 6,284 postings on the live pool — the same "step" meaning
// twenty minutes or four days of judging. Counting gives uniform work, so
// progress means something.
//
// WHY THE BOUNDARY NEVER SPLITS A SCORE. 3,352 postings share score 40. Cut
// that group by count and the split is arbitrary: within one score only
// similarity can discriminate, and similarity is exactly what has not been
// computed yet. So a chunk takes whole score values and overshoots instead.
//
// WHY THE ORDER INSIDE A CHUNK IS STILL THE BLEND. Score decides WHICH
// postings come next; similarity decides which of those is read first.
// Measured inside the 80+ band: blending across the whole band gave the top
// 500 an average fit of 60.7 (50% strong), while taking the band's
// higher-scoring half first and blending inside it gave 73.4 (75% strong) —
// score keeps carrying signal a 40/60 blend does not fully spend.

export const CHUNK_TARGET = 1000;

export interface Chunk {
  lo: number;
  hi: number;
  n: number;
}

// Given the pending postings' score histogram (score -> count), take from the
// top until the target is reached, never splitting a score value.
export function chunkFromHistogram(hist: Array<{ score: number; n: number }>, target = CHUNK_TARGET): Chunk | null {
  const desc = [...hist].filter((h) => h.n > 0).sort((a, b) => b.score - a.score);
  if (desc.length === 0) return null;
  let n = 0;
  let lo = desc[0].score;
  for (const h of desc) {
    n += h.n;
    lo = h.score;
    if (n >= target) break;
  }
  return { lo, hi: desc[0].score, n };
}

export function chunkLabel(c: Chunk): string {
  return c.lo === c.hi ? `puan ${c.lo}` : `puan ${c.lo}-${c.hi}`;
}

export function chunkWhere(c: Chunk | null) {
  return c ? { score: { gte: c.lo, lte: c.hi } } : {};
}

// Parsed from --min-score / --max-score so embed-fill and fit-fill take the
// same range from the worker and mean the same thing by it.
export function chunkFromArgs(args: string[]): Chunk | null {
  const num = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] !== undefined ? Number(args[i + 1]) : null;
  };
  const lo = num("--min-score");
  if (lo === null || Number.isNaN(lo)) return null;
  const hi = num("--max-score");
  return { lo, hi: hi === null || Number.isNaN(hi) ? 1000 : hi, n: 0 };
}
