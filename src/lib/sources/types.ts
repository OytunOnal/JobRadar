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

export async function postJSON(url: string, payload: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// For non-JSON feeds (e.g. Personio's XML). `redirect: "manual"` matters for
// hosts that 307-redirect unknown boards to a marketing page — following the
// redirect would turn a dead board into a healthy-looking 200.
export async function getText(
  url: string,
  opts: { redirect?: RequestRedirect } = {},
): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    redirect: opts.redirect ?? "follow",
  });
  if (res.status !== 200) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
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
