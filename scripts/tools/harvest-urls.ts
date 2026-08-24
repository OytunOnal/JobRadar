import { readFileSync } from "node:fs";
import { prisma } from "../../src/lib/db";
import { scanTextForSlugs } from "../../src/lib/discovery/harvest";
import { findCareerLinks, verifyScanHit } from "../../src/lib/discovery/deepprobe";
import { probeCompany } from "../../src/lib/discovery/nameprobe";
import type { SlugHit } from "../../src/lib/discovery/extract";

// One-off/reusable: run a curated "Company <TAB> careers URL" list through
// the discovery funnel. Direct ATS URLs land via slug extraction; custom
// careers pages get the page scan (page itself → its career links). Every
// hit is probe-verified (live board, ≥1 posting, name match when the
// platform returns one) before touching the pool.
//
//   npx tsx --env-file=.env scripts/harvest-urls.ts config/curated-companies.txt
//
// The list may be stale or even wrong (this one ships two known-bad URLs) —
// that is the point of verification: wrong-company boards are rejected by
// the name check, dead pages report as "nothing found", nothing is stored
// on faith.

const UA = "JobRadar/0.1 (personal job search)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const file = process.argv[2] ?? "config/curated-companies.txt";
const entries = readFileSync(file, "utf8")
  .split(/\r?\n/)
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => {
    const [name, url] = l.split("\t").map((s) => s.trim());
    return { name, url };
  })
  .filter((e) => e.name && e.url);

async function pageFetch(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 600_000);
  } catch {
    return "";
  }
}

// The careers URL itself first (it IS the lead), then its hiring-path links.
async function scanEntry(url: string): Promise<SlugHit[]> {
  const direct = scanTextForSlugs(url).hits;
  if (direct.length > 0) return direct;
  const page = await pageFetch(url);
  const hits = new Map<string, SlugHit>();
  for (const h of scanTextForSlugs(page).hits) hits.set(`${h.platform} ${h.dedupeToken} ${h.region}`, h);
  if (hits.size === 0 && page) {
    let domain = "";
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      /* bad url */
    }
    for (const link of domain ? findCareerLinks(page, domain) : []) {
      for (const h of scanTextForSlugs(await pageFetch(link)).hits) {
        hits.set(`${h.platform} ${h.dedupeToken} ${h.region}`, h);
      }
      if (hits.size > 0) break;
    }
  }
  return [...hits.values()];
}

console.log(`=== Curated-list harvest: ${entries.length} companies from ${file} ===\n`);
let alreadyKnown = 0;
let added = 0;
let rejected = 0;
let nothing = 0;

for (const { name, url } of entries) {
  const hits = await scanEntry(url);
  if (hits.length === 0) {
    // JS-rendered careers pages hide their ATS from a static scan — fall back
    // to tier-4 name-guess probing before giving up.
    const guess = await probeCompany(name);
    if (guess) {
      const existing = await prisma.atsBoard.findUnique({
        where: { platform_token_region: { platform: guess.platform, token: guess.token, region: "" } },
      });
      if (existing) {
        alreadyKnown++;
        console.log(`  =  ${name} — already in the pool (${guess.platform}:${guess.token}, via name)`);
      } else {
        await prisma.atsBoard.create({
          data: {
            platform: guess.platform, token: guess.token, region: "",
            companyName: guess.companyName, status: "active",
            discoveredVia: "curated-list", validatedAt: new Date(),
          },
        });
        added++;
        console.log(`  ✓  ${name} — NEW board ${guess.platform}:${guess.token} (name-probe fallback)`);
      }
      continue;
    }
    nothing++;
    console.log(`  ∅  ${name} — no ATS trace at ${url.slice(0, 60)}`);
    continue;
  }
  let outcome = "rejected";
  for (const hit of hits.slice(0, 3)) {
    const existing = await prisma.atsBoard.findUnique({
      where: { platform_token_region: { platform: hit.platform, token: hit.token, region: hit.region } },
    });
    if (existing) {
      outcome = "known";
      console.log(`  =  ${name} — already in the pool (${hit.platform}:${hit.token})`);
      break;
    }
    const verified = await verifyScanHit(name, hit);
    await sleep(300);
    if (!verified) continue;
    await prisma.atsBoard.create({
      data: {
        platform: verified.platform,
        token: verified.token,
        region: verified.region,
        companyName: verified.companyName,
        status: "active",
        discoveredVia: "curated-list",
        validatedAt: new Date(),
      },
    });
    outcome = "added";
    console.log(`  ✓  ${name} — NEW board ${verified.platform}:${verified.token}`);
    break;
  }
  if (outcome === "known") alreadyKnown++;
  else if (outcome === "added") added++;
  else {
    rejected++;
    console.log(`  ✗  ${name} — trace found but failed verification (dead/empty/wrong company)`);
  }
}

console.log(`\n=== Sonuç: ${added} yeni board, ${alreadyKnown} zaten havuzda, ${rejected} doğrulamadan döndü, ${nothing} iz yok ===`);
await prisma.$disconnect();
