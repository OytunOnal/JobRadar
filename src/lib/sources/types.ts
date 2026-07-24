// The shape every source normalizes into before scoring/storage.
export interface RawJob {
  source: string;
  externalId: string;
  url: string;
  title: string;
  company: string;
  location?: string;
  remote: boolean;
  salaryText?: string;
  description: string;
  postedAt?: Date;
}

export type Source = {
  name: string;
  fetch: () => Promise<RawJob[]>;
};

const UA = "JobRadar/0.1 (personal job search)";

export async function getJSON(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// Strip HTML tags/entities so keyword + LLM scoring see clean text.
export function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
