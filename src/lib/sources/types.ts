// The shape every source normalizes into before scoring/storage.
export type WorkMode = "remote" | "hybrid" | "onsite";

export interface RawJob {
  source: string;
  externalId: string;
  url: string;
  title: string;
  company: string;
  location?: string;
  remote: boolean;
  // Set only when the source states it explicitly (Lever workplaceType,
  // Recruitee's hybrid flag); otherwise deriveWorkMode infers it at ingest.
  workMode?: WorkMode;
  salaryText?: string;
  description: string;
  postedAt?: Date;
  // Set only when the source states sponsorship EXPLICITLY as data (e.g.
  // SwissDevJobs' hasVisaSponsorship field); otherwise ingest derives the
  // signal from the posting text.
  visa?: "yes" | "no" | "unknown";
}

// Explicit source signal wins; otherwise "hybrid" in the posting text beats
// the remote flag (a "hybrid, 2 days office" job often also says remote-ish
// things), then the remote flag, then onsite.
export function deriveWorkMode(job: RawJob): WorkMode {
  if (job.workMode) return job.workMode;
  const text = `${job.title} ${job.location ?? ""} ${job.description.slice(0, 2000)}`;
  if (/\bhybrid\b/i.test(text)) return "hybrid";
  if (job.remote) return "remote";
  return "onsite";
}

export type Source = {
  name: string;
  fetch: () => Promise<RawJob[]>;
};

const UA = "JobRadar/0.1 (personal job search)";

// Global timeout on every base helper: one hung host (connection accepted,
// response never sent) was enough to stall a sequential ~70-source ingest
// indefinitely. A timeout turns the hang into a per-source error the runner
// already knows how to report — and retry.
const FETCH_TIMEOUT_MS = 30_000;

export async function getJSON(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
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
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status !== 200) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

// Strip HTML tags/entities so keyword + LLM scoring see clean text.
// Kept as the name every source connector imports; the implementation now
// lives in lib/html-text.ts, which decodes entities BEFORE stripping tags and
// preserves paragraph/heading/bullet structure. The previous version did the
// reverse and manifested escaped markup into the stored text.
export { htmlToText as stripHtml } from "../html-text";


// Cut a string without leaving half a surrogate pair at the boundary — a lone
// half is unserializable and killed a desc-fill run mid-queue.
export function safeSlice(s: string, max: number): string {
  let out = s.slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return out;
}
