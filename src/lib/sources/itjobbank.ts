import { parseFeed } from "./jobindexdk";
import { type RawJob, type Source } from "./types";

// IT-Jobbank — Denmark's tech-only board, and the same Jobindex window.JIX
// stack our jobindexdk adapter already reads, so it reuses parseFeed verbatim
// (Nordics scan #28, docs/scan-parts/denmark.md). The one difference is the
// whole point: because the board is ALREADY tech-scoped, it needs no query
// matrix — one unfiltered ?format=rss feed is the tech slice, where jobindex
// (general) has to search per profile phrase. So this is a source of its own,
// not a config of jobindex: a different fetch contract, one shared parser.
//
// The feed pages are ~25 items; the walk follows ?page=N until a page repeats
// or runs dry. Bodies are full HTML in the RSS description, stripped by the
// shared parser — no desc:fill needed.
//
// Config: ITJOBBANK_MAX_PAGES (default 6 ≈ 150 newest tech jobs).

const BASE = "https://www.it-jobbank.dk/jobsoegning";
const UA = "Mozilla/5.0 (compatible; JobRadar/0.1; personal job search)";
const MAX_PAGES = Number(process.env.ITJOBBANK_MAX_PAGES) || 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// parseFeed stamps source "jobindexdk"; retag to keep provenance honest and
// let source-trust / dedupe tell the two boards apart.
function retag(jobs: RawJob[]): RawJob[] {
  return jobs.map((j) => ({ ...j, source: "itjobbank" }));
}

export async function fetchItJobbank(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    let xml = "";
    try {
      const res = await fetchImpl(`${BASE}?format=rss${page > 1 ? `&page=${page}` : ""}`, {
        headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) break;
      xml = await res.text();
    } catch {
      break;
    }
    if (!xml.includes("<rss")) break;
    let fresh = 0;
    for (const job of retag(parseFeed(xml))) {
      if (seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      fresh++;
      out.push(job);
    }
    if (fresh === 0) break; // page repeated or ran dry
    await sleep(400);
  }
  return out;
}

export const itjobbank: Source = {
  name: "itjobbank",
  fetch: () => fetchItJobbank(),
};
