import { getText, stripHtml, type RawJob } from "../types";

// Jobvite. Token = board slug. Bootstrap the companyEId off the hosted board
// (the fr=true&nl=1 params are load-bearing — bare URLs 302 to branded
// sites), then pull the full XML feed. app.jobvite.com rate-limits hard
// (429 from the 2nd rapid request) — one feed call per run is fine.

export function extractJobviteEid(html: string): string | null {
  return html.match(/companyEId\s*[:=]\s*['"]([A-Za-z0-9_-]{4,40})['"]/)?.[1] ?? null;
}

export function parseJobviteFeed(xml: string, token: string, company: string): RawJob[] {
  return xml.split(/<job>/i).slice(1)
    .map((chunk) => {
      const pick = (tag: string) =>
        chunk.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, "i"))?.[1]?.trim() ?? "";
      return {
        id: pick("id"), title: stripHtml(pick("title")), region: pick("region"),
        location: stripHtml(pick("location")), date: pick("date"),
        url: pick("detail-url") || pick("apply-url"),
        desc: stripHtml(pick("description")),
      };
    })
    .filter((r) => r.id && r.title)
    .map((r) => ({
      source: `jobvite:${token}`,
      externalId: r.id,
      url: r.url,
      title: r.title,
      company,
      location: [r.location, r.region].filter(Boolean).join(", "),
      remote: /remote/i.test(`${r.title} ${r.location} ${r.region}`),
      description: r.desc || r.title,
      postedAt: r.date ? new Date(r.date) : undefined,
    }));
}

export async function jobvite(token: string, company: string): Promise<RawJob[]> {
  const html = await getText(`https://jobs.jobvite.com/${token}?fr=true&nl=1`);
  const eid = extractJobviteEid(html);
  if (!eid) throw new Error(`jobvite:${token} -> no companyEId on board page`);
  return parseJobviteFeed(await getText(`https://app.jobvite.com/CompanyJobs/Xml.aspx?c=${eid}`), token, company);
}
