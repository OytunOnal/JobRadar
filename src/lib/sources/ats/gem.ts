import { type RawJob } from "../types";

// Gem. Token = board id (jobs.gem.com/<boardId>). Public GraphQL batch
// endpoint. CAUTION (live-verified): unknown boards answer 200 with an empty
// list — indistinguishable from an empty board.

export function mapGemPosting(j: any, token: string, company: string): RawJob | null {
  if (!j?.extId || !j?.title) return null;
  const locs = (j.locations ?? [])
    .map((l: any) => l?.name ?? [l?.city, l?.isoCountry].filter(Boolean).join(", "))
    .filter(Boolean);
  return {
    source: `gem:${token}`,
    externalId: String(j.extId),
    url: `https://jobs.gem.com/${token}/${j.extId}`,
    title: String(j.title).trim(),
    company,
    location: [...new Set(locs)].slice(0, 4).join("; ") as string,
    remote: (j.locations ?? []).some((l: any) => l?.isRemote) ||
      /remote/i.test(String(j.job?.locationType ?? "")),
    description: String(j.title), // body sits behind the detail query
    postedAt: undefined, // only on the detail query
  };
}

export async function gem(token: string, company: string): Promise<RawJob[]> {
  const res = await fetch(`https://jobs.gem.com/api/public/graphql/batch?board=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", batch: "true" },
    body: JSON.stringify([
      {
        operationName: "JobBoardList",
        variables: { boardId: token },
        query:
          "query JobBoardList($boardId: String!) { oatsExternalJobPostings(boardId: $boardId) { jobPostings { id extId title locations { name city isoCountry isRemote } job { locationType employmentType } } } }",
      },
    ]),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`gem:${token} -> HTTP ${res.status}`);
  const data = await res.json();
  const rows: any[] = data?.[0]?.data?.oatsExternalJobPostings?.jobPostings ?? [];
  return rows.map((j: any) => mapGemPosting(j, token, company)).filter((j): j is RawJob => j !== null);
}
