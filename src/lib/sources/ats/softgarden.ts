import { getText, stripHtml, type RawJob } from "../types";

// Softgarden. Token = tenant subdomain. The REST jobslist API is auth-gated
// (401 without a channel key) — the server-rendered widgets page is the
// public surface: one page, all postings, no pagination.

export function parseSoftgardenPage(html: string, token: string, company: string): RawJob[] {
  const out: RawJob[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href="[^"]*\/job\/(\d+)\/([^"?]*)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, id, slug, inner] = m;
    if (seen.has(id)) continue;
    seen.add(id);
    const title = stripHtml(inner).trim().split("\n")[0];
    if (!title) continue;
    out.push({
      source: `softgarden:${token}`,
      externalId: id,
      url: `https://${token}.softgarden.io/job/${id}/${slug}`,
      title,
      company,
      location: "",
      remote: /remote|home\s*office/i.test(title),
      description: title,
      postedAt: undefined,
    });
  }
  return out;
}

export async function softgarden(token: string, company: string): Promise<RawJob[]> {
  return parseSoftgardenPage(await getText(`https://${token}.softgarden.io/en/widgets/jobs`), token, company);
}
