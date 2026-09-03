import { gunzipSync } from "node:zlib";
import { getText, type RawJob, type Source } from "./types";
import { extractJobPostingLd } from "./jsonld";

// SITEMAP + JSON-LD BOARDS, DEFINED RATHER THAN COPIED.
//
// By the time the CEE batch (#44) arrived, this project had written the same
// adapter five times — list a declared sitemap, fetch each detail page, read
// its JobPosting block. demando, cercolavoro, nextleveljobs, freework and
// karriereat each carry their own copy because each was found alone. Three
// more arriving at once is the moment to stop copying: what actually differs
// between them is a URL, a path pattern and a country, so those become a
// record and the walk becomes shared.
//
// The existing five are deliberately left alone. Rewriting working adapters
// to prove a point risks five regressions for no new coverage; they can move
// here the next time one of them needs a change anyway.
//
// Two behaviours are baked in because both were bugs first:
//
//   * ORDER. Sitemaps are not reliably newest-first — jobs.ch served postings
//     from May 2025 at the head of its file — so entries are sorted by
//     lastmod before the budget slices them.
//   * GZIP. Some children are .gz and some are not, and fetch transparently
//     decompresses when the server sets Content-Encoding, so a .gz URL may
//     arrive already plain. The magic bytes decide, never the file extension.

export interface LdBoard {
  name: string;
  sitemap: string;
  /** Which sitemap URLs are postings (the rest are categories and filters). */
  jobPath: RegExp;
  country: string;
  /** Per-ingest detail-fetch budget, and the env var that overrides it. */
  max: number;
  /** Some boards need the company from the URL when the LD only links to it. */
  companyFromUrl?: (url: string) => string | undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchXml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "JobRadar/0.1 (personal job search)" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  const gz = raw[0] === 0x1f && raw[1] === 0x8b;
  return (gz ? gunzipSync(raw) : raw).toString("utf8");
}

/** `<loc>` plus `<lastmod>`, newest first. Handles both index and urlset. */
export function sitemapEntries(xml: string): { url: string; lastmod: string }[] {
  const out: { url: string; lastmod: string }[] = [];
  for (const m of xml.matchAll(
    /<(?:url|sitemap)>\s*<loc>([^<]+)<\/loc>(?:[\s\S]*?<lastmod>([^<]+)<\/lastmod>)?[\s\S]*?<\/(?:url|sitemap)>/g,
  )) {
    out.push({ url: m[1]!.replace(/&amp;/g, "&"), lastmod: m[2] ?? "" });
  }
  return out.sort((a, b) => b.lastmod.localeCompare(a.lastmod));
}

export function mapLdPosting(board: LdBoard, url: string, ld: any): RawJob | null {
  const title = String(ld?.title ?? "").trim();
  if (!title) return null;
  // hiringOrganization arrives three ways across these boards: an inline
  // object with a name, a bare string, or an @id reference whose name lives
  // elsewhere in the graph. When it resolves to nothing, the URL slug is the
  // last honest source — and if that fails too, the row is dropped rather
  // than stored as "?", because company is half our dedupe key.
  const org = ld?.hiringOrganization;
  const named = (typeof org === "string" ? org : String(org?.name ?? "")).trim();
  // dev.bg fills the schema backwards: name holds the company's URL and
  // sameAs holds the actual name ("Kirey"). Rather than special-case one
  // board, prefer whichever field is not a URL — a rule that is right for
  // both the correct shape and the inverted one.
  const sameAs = typeof org?.sameAs === "string" ? org.sameAs.trim() : "";
  const company =
    (!/^https?:/i.test(named) && named) ||
    (!/^https?:/i.test(sameAs) && sameAs) ||
    board.companyFromUrl?.(url) ||
    "";
  if (!company || /^https?:/i.test(company)) return null;
  const site = Array.isArray(ld?.jobLocation) ? ld.jobLocation[0] : ld?.jobLocation;
  const city = String(site?.address?.addressLocality ?? "").trim();
  return {
    source: board.name,
    externalId: url.replace(/\/$/, "").split("/").pop() || url,
    url,
    title,
    company,
    location: [city, board.country].filter(Boolean).join(", "),
    remote: /\bremote\b|home\s?office/i.test(`${title} ${city}`),
    description: String(ld?.description ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim() || `${title} at ${company}.`,
    postedAt: ld?.datePosted && !Number.isNaN(Date.parse(ld.datePosted)) ? new Date(ld.datePosted) : undefined,
  };
}

export function ldBoard(board: LdBoard): Source {
  return {
    name: board.name,
    async fetch(): Promise<RawJob[]> {
      let entries = sitemapEntries(await fetchXml(board.sitemap));
      // One level of index-following: if nothing matches yet, the sitemap was
      // an index and the postings live in one or more children. Optius splits
      // its postings across /sitemap/Job/1 and /Job/2, so children are walked
      // until the budget is met rather than only the first.
      if (!entries.some((e) => board.jobPath.test(e.url))) {
        const children = entries.filter((e) => /job|offer|oglas|listing|vacan/i.test(e.url));
        const collected: { url: string; lastmod: string }[] = [];
        for (const child of children) {
          try {
            collected.push(...sitemapEntries(await fetchXml(child.url)));
          } catch { /* one unreadable child is not a run failure */ }
          if (collected.filter((e) => board.jobPath.test(e.url)).length >= board.max) break;
        }
        entries = collected.sort((a, b) => b.lastmod.localeCompare(a.lastmod));
      }
      const urls = entries.filter((e) => board.jobPath.test(e.url)).slice(0, board.max).map((e) => e.url);

      const out: RawJob[] = [];
      for (const url of urls) {
        try {
          const ld = extractJobPostingLd(await getText(url));
          const job = ld && mapLdPosting(board, url, ld);
          if (job) out.push(job);
        } catch { /* one dead posting is not a run failure */ }
        await sleep(700);
      }
      return out;
    },
  };
}

// ── The boards ───────────────────────────────────────────────────────────────

export const startupjobscz = ldBoard({
  name: "startupjobs-cz",
  sitemap: "https://www.startupjobs.cz/sitemap/offers.xml",
  jobPath: /startupjobs\.cz\/nabidka\//,
  country: "Czechia",
  max: Number(process.env.STARTUPJOBS_MAX) || 25,
});

export const devbg = ldBoard({
  name: "dev-bg",
  sitemap: "https://dev.bg/wp-sitemap-posts-job_listing-1.xml",
  jobPath: /dev\.bg\/company\/jobads\//,
  country: "Bulgaria",
  max: Number(process.env.DEVBG_MAX) || 25,
  // dev.bg's LD links the employer rather than naming it
  // (hiringOrganization → https://dev.bg/company/kirey/), and the slug in
  // that URL is the company. The posting URL carries it too, first segment
  // after /jobads/: "kirey-it-solution-specialist-..." — but a hyphenated
  // slug cannot be split back into a name reliably, so we take it from the
  // detail page's company link instead, resolved in the mapper's fallback.
  companyFromUrl: (url) => url.match(/\/jobads\/([a-z0-9]+)-/i)?.[1],
});

export const optius = ldBoard({
  name: "optius",
  sitemap: "https://www.optius.com/sitemap.xml",
  jobPath: /optius\.com\/iskalci\/prosta-delovna-mesta\//,
  country: "Slovenia",
  max: Number(process.env.OPTIUS_MAX) || 25,
});
