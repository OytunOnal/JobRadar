import { asyncBufferFromUrl, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { extractSlug, type SlugHit } from "./extract";
import { upsertCandidates } from "./store";

// Discovery source #4: the community dataset edwarddgao/open-apply-jobs on
// Hugging Face — daily scrapes of Ashby, Greenhouse, and Lever postings,
// partitioned as data/date=YYYY-MM-DD/source=<ats>/*.parquet.
//
// Its unique value is Lever US: jobs.lever.co robots-blocks Common Crawl and
// Wayback only sees fragments, but this dataset reads the ATS APIs directly.
//
// We never download the ~30GB dataset. hyparquet reads over HTTP byte ranges,
// and we touch ONLY the latest date partition and ONLY two columns
// (source_slug, apply_url) — a few MB of transfer for the full daily universe.

const HF_API = "https://huggingface.co/api/datasets/edwarddgao/open-apply-jobs";
const HF_RESOLVE = "https://huggingface.co/datasets/edwarddgao/open-apply-jobs/resolve/main";

// Dataset "source=" values map 1:1 onto our registry platform ids today;
// keep the map explicit so a new dataset source can't silently mislabel.
const SOURCE_TO_PLATFORM: Record<string, string> = {
  ashby: "ashby",
  greenhouse: "greenhouse",
  lever: "lever",
};

export interface PartitionFile {
  date: string;
  source: string;
  url: string;
}

// From the repo file listing, pick every parquet of the newest date partition.
export function latestPartition(filenames: string[]): PartitionFile[] {
  const re = /^data\/date=(\d{4}-\d{2}-\d{2})\/source=([^/]+)\/(.+\.parquet)$/;
  let newest = "";
  const all: Array<{ date: string; source: string; path: string }> = [];
  for (const f of filenames) {
    const m = f.match(re);
    if (!m) continue;
    all.push({ date: m[1], source: m[2], path: f });
    if (m[1] > newest) newest = m[1];
  }
  return all
    .filter((f) => f.date === newest)
    .map((f) => ({ date: f.date, source: f.source, url: `${HF_RESOLVE}/${f.path}` }));
}

// One dataset row → one board hit. apply_url goes through the real extractor
// (keeps Lever's US/EU region logic); source_slug is the fallback when the
// URL is missing or malformed.
export function rowToHit(
  source: string,
  row: { source_slug?: unknown; apply_url?: unknown },
): SlugHit | null {
  const platform = SOURCE_TO_PLATFORM[source];
  if (!platform) return null;
  if (typeof row.apply_url === "string" && row.apply_url) {
    const hit = extractSlug(row.apply_url);
    if (hit && hit.platform === platform) return hit;
  }
  const slug = typeof row.source_slug === "string" ? row.source_slug.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9 ._&'-]{0,80}$/.test(slug)) return null;
  return { platform, token: slug, dedupeToken: slug, region: "", host: "" };
}

export interface HfReport {
  partitionDate: string;
  files: number;
  rows: number;
  hits: number;
  created: number;
  known: number;
  errors: string[];
}

export async function runHfDiscovery(
  opts: { fetchImpl?: typeof fetch; log?: (m: string) => void } = {},
): Promise<HfReport> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.log ?? (() => {});
  const report: HfReport = {
    partitionDate: "", files: 0, rows: 0, hits: 0, created: 0, known: 0, errors: [],
  };

  const metaRes = await fetchImpl(HF_API, { signal: AbortSignal.timeout(30_000) });
  if (!metaRes.ok) {
    report.errors.push(`dataset metadata: HTTP ${metaRes.status}`);
    return report;
  }
  const meta = (await metaRes.json()) as { siblings?: Array<{ rfilename: string }> };
  const files = latestPartition((meta.siblings ?? []).map((s) => s.rfilename));
  if (files.length === 0) {
    report.errors.push("no date partitions found in the repo listing");
    return report;
  }
  report.partitionDate = files[0].date;

  const found = new Map<string, SlugHit>();
  for (const f of files) {
    try {
      log(`${f.source} (${f.date}) okunuyor…`);
      const file = await asyncBufferFromUrl({ url: f.url });
      const rows = (await parquetReadObjects({
        file,
        columns: ["source_slug", "apply_url"],
        compressors, // dataset uses ZSTD, beyond hyparquet's built-ins
      })) as Array<{ source_slug?: unknown; apply_url?: unknown }>;
      report.files++;
      report.rows += rows.length;
      let hits = 0;
      for (const row of rows) {
        const hit = rowToHit(f.source, row);
        if (!hit) continue;
        hits++;
        found.set(`${hit.platform} ${hit.dedupeToken} ${hit.region}`, hit);
      }
      log(`  ${rows.length} satir -> ${hits} hit`);
    } catch (e: any) {
      report.errors.push(`${f.source}: ${e.message}`);
    }
  }

  report.hits = found.size;
  const stored = await upsertCandidates(found.values(), "hf-dataset");
  report.created = stored.created;
  report.known = stored.known;
  return report;
}
