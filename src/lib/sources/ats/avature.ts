import { getText, stripHtml, type RawJob } from "../types";

// Avature. Token = "<host>/<locale>/<site>" (careers.avature.net/en_US/main).
// The SearchJobs RSS feed is the simplest stable surface.

export function parseAvatureFeed(xml: string, token: string, company: string): RawJob[] {
  return xml.split(/<item>/i).slice(1)
    .map((chunk) => {
      const pick = (tag: string) =>
        chunk.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, "i"))?.[1]?.trim() ?? "";
      const link = pick("link") || pick("guid");
      const title = stripHtml(pick("title"));
      const desc = stripHtml(pick("description"));
      const id = link.match(/\/(\d+)(?:\?|$)/)?.[1] ?? link;
      return { link, title, desc, id };
    })
    .filter((r) => r.title && r.link)
    .map((r) => ({
      source: `avature:${token}`,
      externalId: String(r.id),
      url: r.link,
      title: r.title,
      company,
      location: r.desc.split(" - ")[0] ?? "", // "Argentina - 7221" convention
      remote: /remote/i.test(`${r.title} ${r.desc}`),
      description: r.desc || r.title,
      postedAt: undefined,
    }));
}

export async function avature(token: string, company: string): Promise<RawJob[]> {
  return parseAvatureFeed(await getText(`https://${token}/SearchJobs/feed/?jobRecordsPerPage=500`), token, company);
}
