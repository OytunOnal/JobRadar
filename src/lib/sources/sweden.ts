import { stripHtml, type RawJob, type Source } from "./types";

// Sweden — Arbetsförmedlingen's JobTech data, now via the JOBSTREAM
// change-delta API rather than query-window search. The Nordics scan (#28)
// verified the stream and the switch closes the old adapter's structural
// blind spot: a query-based fetch can only see ads that match one of the
// profile's search phrases, so an ad no query matched was never seen at all.
// The stream carries EVERY change since a timestamp — full ad objects with
// complete bodies — and the keyword scorer does the filtering where it
// belongs. Removal deltas arrive too; they are skipped for now (sources have
// no removal channel to ingest yet) and the pool clock handles aging.
//
// Operational shape, measured before writing: a 30-minute slice was 463 ads
// / 3.7MB and answered instantly; a 3-hour slice answered 502. So the walk
// is hour-sized slices with one patient retry each, cursored in SourceState
// (name "sweden-jobstream", lastFetchedAt IS the cursor — the one consumer
// of that table whose value fits the column as designed).
//
// The ad object is the same shape JobSearch served, so mapHit — and every
// stored row's identity — carries over unchanged.
//
// Config: SWEDEN_STREAM_MAX_HOURS (26) per run, catching up a missed day.

const STREAM_URL = "https://jobstream.api.jobtechdev.se/stream";
const UA = "JobRadar/0.1 (personal job search)";
const MAX_HOURS = Number(process.env.SWEDEN_STREAM_MAX_HOURS) || 26;
const SLICE_MS = 60 * 60 * 1_000;
const CURSOR = "sweden-jobstream";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mapHit(h: any): RawJob | null {
  if (!h?.id || !h?.headline) return null;
  const city = h.workplace_address?.municipality;
  return {
    source: "sweden-jobtech",
    externalId: String(h.id),
    // application_details.url is the employer's own channel when present;
    // webpage_url is the Platsbanken detail page.
    url: String(h.application_details?.url || h.webpage_url || ""),
    title: String(h.headline),
    company: String(h.employer?.name ?? ""),
    location: city ? `${city}, Sweden` : "Sweden",
    remote: false, // no reliable flag; the work-mode detector reads the text
    description: stripHtml(h.description?.text ?? ""),
    postedAt: h.publication_date ? new Date(h.publication_date) : undefined,
  };
}

export async function fetchSweden(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const { prisma } = await import("../db");
  const state = await prisma.sourceState.findUnique({ where: { name: CURSOR } });
  const now = Date.now();
  // First run reaches back one day; afterwards, from wherever we left off,
  // capped so a long outage catches up over several runs instead of one
  // giant request the API answers with a 502.
  let from = state ? state.lastFetchedAt.getTime() : now - 24 * 3_600_000;
  from = Math.max(from, now - MAX_HOURS * 3_600_000);

  const out: RawJob[] = [];
  const seen = new Set<string>();
  let cursorEnd = from;
  for (let t = from; t < now; t += SLICE_MS) {
    const sliceIso = new Date(t).toISOString().slice(0, 19);
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        const res = await fetchImpl(`${STREAM_URL}?date=${encodeURIComponent(sliceIso)}&updated-before-date=${encodeURIComponent(new Date(Math.min(t + SLICE_MS, now)).toISOString().slice(0, 19))}`, {
          headers: { "User-Agent": UA, Accept: "application/json" },
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ads: any[] = await res.json();
        for (const ad of ads) {
          if (ad?.removed) continue; // no removal channel yet — see header
          const job = mapHit(ad);
          if (!job || !job.url || seen.has(job.externalId)) continue;
          seen.add(job.externalId);
          out.push(job);
        }
        ok = true;
      } catch {
        if (attempt === 0) await sleep(10_000); // index under load — one patient retry
      }
    }
    // The cursor only advances past slices that were actually read: a failed
    // hour is retried next run rather than silently skipped.
    if (!ok) break;
    cursorEnd = Math.min(t + SLICE_MS, now);
    await sleep(500);
  }

  if (cursorEnd > from) {
    await prisma.sourceState.upsert({
      where: { name: CURSOR },
      update: { lastFetchedAt: new Date(cursorEnd) },
      create: { name: CURSOR, lastFetchedAt: new Date(cursorEnd) },
    });
  }
  return out;
}

export const sweden: Source = {
  name: "sweden-jobtech",
  fetch: () => fetchSweden(),
};
