import { getText, type RawJob, type Source } from "./types";

// VisaJobs.ie — Ireland-only sponsorship board built on the DETE permit
// register, found by the 2026-09 country scan (docs/scan-parts/ireland.md).
// Open robots, keyless server-rendered pages, ?page=N pagination at 30/page.
// Two things make it worth a bespoke adapter:
//
//   * every employer is screened against the same government register we
//     ingest (and now hold with permit counts), so the population is
//     sponsorship-dense by construction — VISA_FOCUSED_SOURCES membership
//     gives its postings the "maybe" tier the same way huntukvisa gets it;
//   * it re-serves IrishJobs.ie rows ("via IrishJobs.ie" on the card) that
//     are otherwise unreachable behind Akamai — indirect coverage of
//     Ireland's biggest board.
//
// The list card carries a teaser only; the full body is on the detail page
// (server-rendered, no JSON-LD), which desc:fill fetches through
// fetchVisaJobsIeDetail for rows that earn it.
//
// Config: VISAJOBSIE_MAX_PAGES (default 5 ≈ 150 newest jobs per ingest).

const BASE = "https://visajobs.ie";
const MAX_PAGES = Number(process.env.VISAJOBSIE_MAX_PAGES) || 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface VisaJobsIeCard {
  id: string;
  title: string;
  company: string;
  location: string;
  via: string | null;
  teaser: string;
}

// Cards are anchor-titled blocks: the /jobs/{id} link wraps the title, the
// company is either a /companies/ link or the first font-medium span, and
// "via <board>" names where the posting originally ran. Per-field shallow
// regexes, same rule as huntukvisa: a class rename breaks one field visibly.
export function parseVisaJobsIeList(html: string): VisaJobsIeCard[] {
  const out: VisaJobsIeCard[] = [];
  const seen = new Set<string>();
  const chunks = html.split(/href="\/jobs\/(\d+)">/).slice(1);
  // split with a capture group yields [id, chunk, id, chunk, ...]
  for (let i = 0; i + 1 < chunks.length; i += 2) {
    const id = chunks[i]!;
    const body = chunks[i + 1]!.slice(0, 3000);
    if (seen.has(id)) continue;
    const title = body.match(/^([^<]+)</)?.[1]?.trim();
    if (!title) continue;
    const company =
      body.match(/href="\/companies\/[^"]+">([^<]+)<\/a>/)?.[1]?.trim() ??
      body.match(/<span class="font-medium">([^<]+)<\/span>/)?.[1]?.trim();
    if (!company) continue;
    // The location is the span right after the company separator.
    const location = body.match(/<\/(?:a|span)><span[^>]*>\|<\/span><span>([^<]+)<\/span>/)?.[1]?.trim() ?? "";
    const via = body.match(/via <!-- -->([^<]+)</)?.[1]?.trim() ?? null;
    const teaser = body.match(/line-clamp-2">([^<]+)</)?.[1]?.trim() ?? "";
    seen.add(id);
    out.push({ id, title, company, location, via, teaser });
  }
  return out;
}

export function mapVisaJobsIeCard(c: VisaJobsIeCard): RawJob {
  return {
    source: "visajobsie",
    externalId: c.id,
    url: `${BASE}/jobs/${c.id}`,
    title: c.title,
    company: c.company,
    location: c.location ? `${c.location}, Ireland` : "Ireland",
    remote: /\bremote\b/i.test(`${c.title} ${c.location}`),
    description: [
      `${c.title} at ${c.company} (${c.location || "Ireland"}).`,
      c.teaser,
      c.via ? `Originally listed on ${c.via}.` : "",
    ].filter(Boolean).join(" "),
  };
}

// The scorecard every detail page carries: fit N/100 with a verdict word,
// then three scored components with their evidence lines ("10 permits
// issued, most recent 2026"). This is the board's whole value distilled -
// the site computes it from the same DETE register we ingest, plus
// occupation lists and salary floors we do not hold - so it travels at the
// TOP of the body where the judge reads it. As text, never as structured
// visa evidence: it is company-and-occupation inference, not the posting
// stating sponsorship (the huntukvisa rule).
export function parseVisaJobsIeScorecard(html: string): string {
  const t = html.replace(/<[^>]+>/g, "|").replace(/\s+/g, " ");
  const fit = t.match(/Sponsorship fit\|+(\d+)\|+\/ 100\|+([^|]+)\|/);
  if (!fit) return "";
  const lines = [`Sponsorship fit ${fit[1]}/100 (${fit[2]!.trim()}).`];
  for (const c of t.matchAll(/(Employer sponsorship history|Role eligibility|Salary vs permit floor)\|+(\d+)\|+\/\|+(\d+)\|+([^|]+)\|/g)) {
    lines.push(`${c[1]}: ${c[2]}/${c[3]} - ${c[4]!.trim()}.`);
  }
  return lines.join(" ");
}

/** The body, for desc:fill. Two page shapes exist: postings mirrored from
 * boards (via IrishJobs etc.) carry full prose under a "Job Description"
 * heading; direct company-page listings carry only the scorecard and link
 * out. Both get the scorecard; the prose rides along where it exists. */
export async function fetchVisaJobsIeDetail(externalId: string): Promise<string> {
  const html = await getText(`${BASE}/jobs/${externalId}`);
  const scorecard = parseVisaJobsIeScorecard(html);
  const i = html.search(/Job Description/i);
  let prose = "";
  if (i >= 0) {
    const slice = html.slice(i, i + 20_000).split(/Similar Jobs|Apply for this/i)[0] ?? "";
    prose = slice
      .replace(/<[^>]+>/g, " ")
      .replace(/\\n/g, "\n")
      .replace(/\*\*/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return [scorecard, prose].filter(Boolean).join("\n\n");
}

export const visajobsie: Source = {
  name: "visajobsie",
  async fetch(): Promise<RawJob[]> {
    const out: RawJob[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const html = await getText(`${BASE}/jobs?page=${page}`);
      const cards = parseVisaJobsIeList(html);
      if (cards.length === 0) break;
      for (const c of cards) out.push(mapVisaJobsIeCard(c));
      if (page < MAX_PAGES) await sleep(1_200);
    }
    return out;
  },
};
