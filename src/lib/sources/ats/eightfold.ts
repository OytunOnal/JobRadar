import { getJSON, stripHtml, type RawJob } from "../types";

// Eightfold.ai. Token = tenant subdomain (bayer). Server caps pages at 10
// rows regardless of num (live-verified), so big boards cost count/10 calls —
// capped here. 403 "Not authorized for PCSX" = tenant hasn't enabled the
// public career-site API (not bot detection); such boards are unservable.

export function mapEightfoldPosition(j: any, token: string, company: string): RawJob | null {
  if (!j?.id || !j?.name) return null;
  const locs = [j.location, ...(j.locations ?? [])].filter(Boolean);
  return {
    source: `eightfold:${token}`,
    externalId: String(j.id),
    url: String(j.canonicalPositionUrl ?? `https://${token}.eightfold.ai/careers/job/${j.id}`),
    title: String(j.name).trim(),
    company,
    location: [...new Set(locs)].slice(0, 4).join("; "),
    remote: locs.some((l: string) => /remote/i.test(l)),
    description: stripHtml(String(j.job_description ?? "")) || String(j.name),
    postedAt: j.t_create ? new Date(Number(j.t_create) * 1000) : undefined, // unix SECONDS
  };
}

export async function eightfold(token: string, company: string): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (let start = 0; start < 1500; start += 10) {
    const data = await getJSON(
      `https://${token}.eightfold.ai/api/apply/v2/jobs?start=${start}&num=10`,
    );
    const rows: any[] = data?.positions ?? [];
    for (const j of rows) {
      const job = mapEightfoldPosition(j, token, company);
      if (job) out.push(job);
    }
    const total = Number(data?.count ?? 0);
    if (rows.length === 0 || start + 10 >= total) break;
  }
  return out;
}
