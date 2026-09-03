import { prisma } from "../db";
import { stripHtml, type RawJob, type Source } from "./types";

// Norway — NAV's pam-stilling-feed, the national ad pool behind a self-serve
// public token. Top find of the Nordics scan (#28, docs/scan-parts/norway.md)
// and verified end to end before this adapter existed: the feed is a
// JSON-Feed linked list (pages of 1,000, `next_url` chaining from 2023), so
// it reads like the Wayback cut — position once, then resume incrementally.
//
// The list page carries `_feed_entry` with title, businessName, municipal
// and an ACTIVE/INACTIVE status — enough for a cheap sighting; the full body
// lives one call away at /api/v1/feedentry/{uuid}, which desc:fill spends
// only on rows that earn it (the SmartRecruiters trade). Most ads are
// Norwegian-language public-sector volume; the keyword scorer and langReq
// flags do their usual honest filtering, and "no" is already in
// JUDGE_TARGETS, so what survives judges immediately.
//
// The cursor lives in SourceState as a row NAMED `navfeed:{next_id}` — the
// same encode-it-in-the-name pattern the archive lane uses for ccindex rows.
// First run positions at the newest page (?last=true): the 2023 backlog is
// expired history, not backfill.
//
// Config: NAVNO_MAX_PAGES (default 5 ≈ 5,000 sightings per ingest).

const BASE = "https://pam-stilling-feed.nav.no";
const MAX_PAGES = Number(process.env.NAVNO_MAX_PAGES) || 5;
const CURSOR_PREFIX = "navfeed:";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The token endpoint wraps the JWT in a human sentence ("Current public
// token for ..."), so it is extracted, not trusted as a bare body.
export function extractToken(raw: string): string | null {
  return raw.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)?.[0] ?? null;
}

async function publicToken(): Promise<string> {
  const raw = await (await fetch(`${BASE}/api/publicToken`, {
    headers: { "User-Agent": "JobRadar/0.1 (personal job search)" },
    signal: AbortSignal.timeout(20_000),
  })).text();
  const jwt = extractToken(raw);
  if (!jwt) throw new Error("nav-no: no JWT in publicToken response");
  return jwt;
}

async function getAuthed(path: string, jwt: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "User-Agent": "JobRadar/0.1 (personal job search)", Authorization: `Bearer ${jwt}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`nav-no ${path} -> HTTP ${res.status}`);
  return res.json();
}

export function mapFeedItem(item: any): RawJob | null {
  const fe = item?._feed_entry;
  const uuid = String(fe?.uuid ?? "").trim();
  const title = String(fe?.title ?? item?.title ?? "").trim();
  if (!uuid || !title) return null;
  if (fe?.status && fe.status !== "ACTIVE") return null;
  const municipal = String(fe?.municipal ?? "").trim();
  return {
    source: "nav-no",
    externalId: uuid,
    url: `https://arbeidsplassen.nav.no/stillinger/stilling/${uuid}`,
    title,
    company: String(fe?.businessName ?? "").trim() || "?",
    location: municipal
      ? `${municipal.charAt(0) + municipal.slice(1).toLowerCase()}, Norway`
      : "Norway",
    remote: false, // the detector reads the text once desc:fill lands a body
    description: title,
    postedAt: item?.date_modified && !Number.isNaN(Date.parse(item.date_modified))
      ? new Date(item.date_modified)
      : undefined,
  };
}

/** The full body, for desc:fill. */
export async function fetchNavNoDetail(uuid: string): Promise<string> {
  const jwt = await publicToken();
  const e = await getAuthed(`/api/v1/feedentry/${encodeURIComponent(uuid)}`, jwt);
  const ad = e?.ad_content ?? {};
  return stripHtml(String(ad.description ?? ""));
}

export const navno: Source = {
  name: "nav-no",
  async fetch(): Promise<RawJob[]> {
    const jwt = await publicToken();

    // Resume from the stored cursor; a fresh install positions at the newest
    // page rather than walking three years of expired ads.
    const cursorRow = await prisma.sourceState.findFirst({
      where: { name: { startsWith: CURSOR_PREFIX } },
    });
    let pageUrl = cursorRow
      ? `/api/v1/feed/${cursorRow.name.slice(CURSOR_PREFIX.length)}`
      : "/api/v1/feed?last=true";

    const out: RawJob[] = [];
    let lastPageId: string | null = null;
    for (let page = 0; page < MAX_PAGES && pageUrl; page++) {
      let data: any;
      try {
        data = await getAuthed(pageUrl, jwt);
      } catch {
        break; // a mid-walk failure keeps the old cursor: next run retries
      }
      for (const item of data.items ?? []) {
        const job = mapFeedItem(item);
        if (job) out.push(job);
      }
      lastPageId = String(data.id ?? "") || lastPageId;
      pageUrl = data.next_url ? String(data.next_url).replace(BASE, "") : "";
      if (pageUrl) await sleep(500);
    }

    // The cursor advances only after a walk that produced pages — and it
    // points at the LAST page consumed, so the next run re-reads it (cheap)
    // and follows anything new. Re-sighting is idempotent by design.
    if (lastPageId) {
      await prisma.$transaction([
        prisma.sourceState.deleteMany({ where: { name: { startsWith: CURSOR_PREFIX } } }),
        prisma.sourceState.create({ data: { name: CURSOR_PREFIX + lastPageId, lastFetchedAt: new Date() } }),
      ]);
    }
    return out;
  },
};
