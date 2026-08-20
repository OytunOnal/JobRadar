import { stripHtml, type RawJob, type Source } from "./types";

// WeWorkRemotely: RSS feeds per category. No JSON API, so we parse the RSS
// items with a small regex extractor (no XML dependency needed).
// One feed per category (each carries that category's full current list).
// Persona-agnostic spread: scoring filters, so unused categories only cost
// one fetch. All slugs verified live 2026-08.
const FEEDS = [
  "https://weworkremotely.com/categories/remote-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
  "https://weworkremotely.com/categories/remote-design-jobs.rss",
  "https://weworkremotely.com/categories/remote-product-jobs.rss",
  "https://weworkremotely.com/categories/remote-management-and-finance-jobs.rss",
  "https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss",
];

function extractItems(xml: string): RawJob[] {
  const items: RawJob[] = [];
  const blocks = xml.split(/<item>/).slice(1);
  for (const block of blocks) {
    const body = block.split(/<\/item>/)[0];
    const pick = (tag: string) => {
      const m = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      if (!m) return "";
      return m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
    };
    const link = pick("link");
    if (!link) continue;
    // WWR titles look like "Company: Job Title"
    const rawTitle = stripHtml(pick("title"));
    const [company, ...rest] = rawTitle.split(":");
    const title = rest.length ? rest.join(":").trim() : rawTitle;
    const region = pick("region");
    items.push({
      source: "weworkremotely",
      externalId: link.split("/").filter(Boolean).pop() ?? link,
      url: link,
      title,
      company: rest.length ? company.trim() : "",
      location: region || "Remote",
      remote: true,
      description: stripHtml(pick("description")),
      postedAt: pick("pubDate") ? new Date(pick("pubDate")) : undefined,
    });
  }
  return items;
}

export const weworkremotely: Source = {
  name: "weworkremotely",
  async fetch(): Promise<RawJob[]> {
    const out: RawJob[] = [];
    const seen = new Set<string>();
    for (const feed of FEEDS) {
      try {
        const res = await fetch(feed, { headers: { "User-Agent": "JobRadar/0.1" } });
        if (!res.ok) continue;
        // The umbrella programming feed overlaps the per-stack ones.
        for (const job of extractItems(await res.text())) {
          if (seen.has(job.externalId)) continue;
          seen.add(job.externalId);
          out.push(job);
        }
      } catch {
        // skip a bad feed
      }
    }
    return out;
  },
};
