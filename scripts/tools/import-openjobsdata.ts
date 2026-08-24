import { prisma } from "../../src/lib/db";
import { upsertCandidates } from "../../src/lib/discovery/store";
import type { SlugHit } from "../../src/lib/discovery/extract";

// Seed from ConorsCode/open-jobs-data (MIT): a daily-refreshed GitHub dataset
// whose companies.json maps ~378 companies to ATS platform+slug. We don't
// ingest its JOBS (we pull those ATSs directly) — the company map goes into
// the discovery candidate table and validation probes it like any other hit.
//
//   npx tsx --env-file=.env scripts/import-openjobsdata.ts

const RAW = "https://raw.githubusercontent.com/ConorsCode/open-jobs-data/main/companies.json";

// Their platform names -> our registry ids (unknown ones are reported, not stored).
const PLATFORM_MAP: Record<string, string> = {
  greenhouse: "greenhouse",
  lever: "lever",
  ashby: "ashby",
  ashbyhq: "ashby",
  smartrecruiters: "smartrecruiters",
  workable: "workable",
  recruitee: "recruitee",
  personio: "personio",
  workday: "workday",
  bamboohr: "bamboohr",
  breezy: "breezy",
  teamtailor: "teamtailor",
  pinpoint: "pinpoint",
  jobvite: "jobvite",
  rippling: "rippling",
};

async function main() {
  const res = await fetch(RAW, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`companies.json -> HTTP ${res.status}`);
  const data = await res.json();
  const rows: any[] = Array.isArray(data) ? data : data?.companies ?? [];
  console.log(`open-jobs-data: ${rows.length} companies`);

  const hits: SlugHit[] = [];
  const unknown = new Map<string, number>();
  for (const c of rows) {
    const rawPlatform = String(c?.platform ?? c?.ats ?? c?.source ?? "").toLowerCase();
    const token = String(c?.slug ?? c?.token ?? c?.board ?? "").trim();
    const platform = PLATFORM_MAP[rawPlatform];
    if (!platform || !token) {
      if (rawPlatform) unknown.set(rawPlatform, (unknown.get(rawPlatform) ?? 0) + 1);
      continue;
    }
    hits.push({ platform, token: token.toLowerCase(), dedupeToken: token.toLowerCase(), region: "", host: "" });
  }
  const stored = await upsertCandidates(hits, "open-jobs-data");
  console.log(`${hits.length} mapped -> ${stored.created} new candidates, ${stored.known} already known`);
  if (unknown.size) console.log("unmapped platforms:", [...unknown.entries()].map(([k, v]) => `${k}(${v})`).join(", "));
  await prisma.$disconnect();
}
main();
