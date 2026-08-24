import { getText, stripHtml, type RawJob } from "../types";

// Teamtailor: public per-tenant RSS at <slug>.teamtailor.com/jobs.rss.
// (Most customers CNAME a branded domain — the registry only sees the
// *.teamtailor.com minority; job links may point at the branded host.)

function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return "";
  return m[1].replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "").trim();
}

export function parseTeamtailorFeed(xml: string, token: string, company: string): RawJob[] {
  const out: RawJob[] = [];
  for (const block of xml.split(/<item>/).slice(1)) {
    const body = block.split(/<\/item>/)[0];
    const link = pick(body, "link");
    const title = stripHtml(pick(body, "title"));
    if (!link || !title) continue;
    const pub = pick(body, "pubDate");
    out.push({
      source: `teamtailor:${token}`,
      externalId: link.split("/").filter(Boolean).pop() ?? link,
      url: link,
      title,
      company,
      location: stripHtml(pick(body, "tt:location") || pick(body, "location") || pick(body, "tt:city")),
      remote: /remote/i.test(title),
      description: stripHtml(pick(body, "description")),
      postedAt: pub ? new Date(pub) : undefined,
    });
  }
  return out;
}

export async function teamtailor(token: string, company: string): Promise<RawJob[]> {
  return parseTeamtailorFeed(await getText(`https://${token}.teamtailor.com/jobs.rss`), token, company);
}
