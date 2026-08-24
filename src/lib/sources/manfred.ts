import { type RawJob, type Source } from "./types";

// Manfred — Spanish tech job platform with a genuinely open public API:
// every ACTIVE offer with salary range, remote percentage, and locations in
// one request (~1.6k offers). The list carries no description body, so this
// is two-stage: the free title score gates which offers get a detail call
// (introduction / responsibilities / requirements / tech stack).
//
// The list carries a summary; the named blocks live behind the detail
// endpoint, which desc:fill calls.

const LIST_URL = "https://www.getmanfred.com/api/v2/public/offers?lang=EN";
const DETAIL_URL = "https://www.getmanfred.com/api/v2/public/offers";
const UA = "JobRadar/0.1 (personal job search)";
// The store gate used to live here too, as a fourth copy of `20` — one per
// connector that fetched detail pages. It decided what the pool may contain,
// which is ingest's decision; the number now exists once, in derive.ts, and
// this connector no longer needs it.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mapOffer(o: any, description = ""): RawJob | null {
  if (!o?.id || !o?.position || o?.status !== "ACTIVE") return null;
  const salary =
    o.salaryTo ? `${o.salaryFrom || "?"}–${o.salaryTo} ${o.currency ?? "€"}` : undefined;
  const pct = Number(o.remotePercentage ?? 0);
  const workMode = pct >= 100 ? "remote" : pct > 0 ? "hybrid" : "onsite";
  const locations = Array.isArray(o.locations) ? o.locations.filter(Boolean).join("; ") : "";
  return {
    source: "manfred",
    externalId: String(o.id),
    url: `https://www.getmanfred.com/en/job-offers/${o.id}/${o.slug ?? ""}`,
    title: String(o.position),
    company: String(o.company?.name ?? ""),
    location: locations || "Spain",
    remote: workMode === "remote",
    workMode,
    salaryText: salary,
    description,
    postedAt: o.updatedAt ? new Date(o.updatedAt) : undefined,
  };
}

// Detail sections → one readable description.
// Manfred names every block; report the names so the section parser reads
// them as headings instead of guessing from one run-on wall of text.
export function detailSections(d: any): Array<[string, unknown]> {
  const flatten = (v: unknown) =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string").join("\n") : v;
  return [
    ["", flatten(d?.introduction)],
    ["Responsibilities", flatten(d?.whatWillYouDo)],
    ["Requirements", flatten(d?.whatTheyAskFor)],
    ["Responsibilities", flatten(d?.responsibilities)],
    ["Tech stack", Array.isArray(d?.techs) ? d.techs.map((t: any) => t?.name ?? t).join(", ") : ""],
  ];
}

async function getJson(url: string, fetchImpl: typeof fetch): Promise<any | null> {
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Called by desc:fill, which owns detail fetching for every platform. It
// returns the source's named PARTS, not an assembled text — assembling is the
// consumer's decision, the same rule the connector seam follows.
export async function fetchDetailSections(id: string, fetchImpl: typeof fetch = fetch): Promise<Array<[string, unknown]>> {
  const detail = await getJson(`${DETAIL_URL}/${id}?lang=EN`, fetchImpl);
  return detail ? detailSections(detail) : [];
}

export async function fetchManfred(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const list = await getJson(LIST_URL, fetchImpl);
  if (!Array.isArray(list)) return [];

  // Every offer the list carried. The named blocks behind the detail endpoint
  // are desc:fill's to fetch, ordered by the stored score.
  return list.map((o) => mapOffer(o)).filter((j): j is RawJob => j !== null);
}

export const manfred: Source = {
  name: "manfred",
  fetch: () => fetchManfred(),
};
