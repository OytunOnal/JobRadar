import { prisma } from "../db";
import { chat } from "../llm/llm";
import { scanTextForSlugs } from "./harvest";
import { namesMatch } from "./nameprobe";
import { probeBoard } from "./validate";
import type { SlugHit } from "./extract";

// Harvest tier 5: the rescue lane for name-probe misses. Slug guessing failed,
// but the company still probably runs an ATS — its careers page will say
// which. Chain: one batched LLM call resolves official website domains →
// fetch the homepage (and its careers link) → the existing harvest scanner
// finds ATS embeds/links → probe-verify before storing.
//
// Trust model: the LLM only supplies the DOMAIN (hallucination-guarded:
// "null if unsure", plausibility checks, social/wiki domains rejected). The
// ATS evidence comes from the company's own page, so name-returning platforms
// verify by name as usual, while Lever/Ashby (nameless probes) are accepted
// on page-evidence + a live board with ≥1 posting.

const UA = "JobRadar/0.1 (personal job search)";
const PAGES_PER_COMPANY = 3; // homepage + up to 2 careers links

export function websitePrompt(names: string[]): string {
  return [
    "For each company, give its official website domain (bare domain, no protocol).",
    'Unsure, ambiguous, or the company is a staffing agency → null. Return STRICT JSON: {"answers": {"<number>": "<domain or null>"}}',
    "",
    ...names.map((n, i) => `${i + 1}. ${n}`),
  ].join("\n");
}

// Exact-domain rejects — a substring regex would swallow innocents
// ("playrix.com" ends in "x.com").
const REJECT_DOMAINS = [
  "linkedin.com", "facebook.com", "wikipedia.org", "twitter.com", "x.com",
  "instagram.com", "crunchbase.com", "glassdoor.com", "indeed.com", "youtube.com",
];
function isRejectedDomain(domain: string): boolean {
  return REJECT_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

export function parseWebsiteAnswers(raw: string, count: number): Array<string | null> {
  const out: Array<string | null> = new Array(count).fill(null);
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return out;
  try {
    const answers = JSON.parse(m[0]).answers ?? {};
    for (let i = 0; i < count; i++) {
      let v = answers[String(i + 1)];
      if (typeof v !== "string") continue;
      v = v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      if (!/^[a-z0-9][a-z0-9.-]{2,60}\.[a-z]{2,}$/.test(v)) continue;
      if (isRejectedDomain(v)) continue;
      out[i] = v;
    }
  } catch {
    /* malformed → all null */
  }
  return out;
}

// Career-page links inside a homepage: same-site (or jobs./careers. subdomain)
// hrefs whose path smells like hiring.
export function findCareerLinks(html: string, domain: string): string[] {
  const links = new Set<string>();
  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    let href = m[1].replace(/&amp;/g, "&");
    if (href.startsWith("//")) href = "https:" + href;
    if (href.startsWith("/")) href = `https://${domain}${href}`;
    if (!/^https?:\/\//.test(href)) continue;
    try {
      const u = new URL(href);
      const sameSite = u.hostname === domain || u.hostname.endsWith("." + domain);
      if (!sameSite) continue;
      if (/career|jobs|join[-_]?us|vacanc|work[-_]?with|open[-_]?positions|stellen/i.test(u.pathname + u.hostname.replace("." + domain, ""))) {
        links.add(u.toString().split("#")[0]);
      }
    } catch {
      /* bad href */
    }
  }
  return [...links].slice(0, PAGES_PER_COMPANY - 1);
}

async function pageFetch(url: string, fetchImpl: typeof fetch): Promise<string> {
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 600_000);
  } catch {
    return "";
  }
}

// Scan a company's site for ATS identity: homepage first (often links or even
// embeds the board), then its careers links, then the conventional /careers.
export async function scanCompanySite(
  domain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SlugHit[]> {
  const hits = new Map<string, SlugHit>();
  const add = (found: SlugHit[]) => {
    for (const h of found) hits.set(`${h.platform} ${h.dedupeToken} ${h.region}`, h);
  };

  const home = await pageFetch(`https://${domain}`, fetchImpl);
  add(scanTextForSlugs(home).hits);
  if (hits.size > 0) return [...hits.values()];

  const careerLinks = home ? findCareerLinks(home, domain) : [];
  const targets = careerLinks.length > 0 ? careerLinks : [`https://${domain}/careers`, `https://${domain}/jobs`];
  for (const url of targets.slice(0, PAGES_PER_COMPANY - 1)) {
    add(scanTextForSlugs(await pageFetch(url, fetchImpl)).hits);
    if (hits.size > 0) break;
  }
  return [...hits.values()];
}

// Page evidence + live board = accept; name-returning platforms must ALSO
// name-match (a stale embed can point at an agency's shared board).
export async function verifyScanHit(
  companyName: string,
  hit: SlugHit,
  probeFn: typeof probeBoard = probeBoard,
): Promise<{ platform: string; token: string; region: string; companyName: string } | null> {
  const outcome = await probeFn(hit.platform, hit.token, hit.region);
  if (outcome.result !== "active") return null;
  if (!outcome.jobCount || outcome.jobCount < 1) return null;
  if (outcome.companyName && !namesMatch(companyName, outcome.companyName)) return null;
  return {
    platform: hit.platform,
    token: hit.token,
    region: hit.region,
    companyName: outcome.companyName ?? companyName,
  };
}

export interface DeepProbeReport {
  checked: number;
  sitesResolved: number;
  found: number;
}

export async function runDeepProbes(
  budget: number,
  deps: { chatFn?: typeof chat; fetchImpl?: typeof fetch; probeFn?: typeof probeBoard } = {},
): Promise<DeepProbeReport> {
  const report: DeepProbeReport = { checked: 0, sitesResolved: 0, found: 0 };
  const rows = await prisma.companyProbe.findMany({
    where: { found: false, deepChecked: false },
    orderBy: { id: "asc" },
    take: budget,
  });
  if (rows.length === 0) return report;
  report.checked = rows.length;

  const names = rows.map((r) => r.displayName ?? r.name);
  // Rows that already carry a website (e.g. seeded from a VC portfolio list)
  // skip the LLM entirely — only the unknown ones get resolved.
  const domains: Array<string | null> = rows.map((r) => r.website ?? null);
  const unknownIdx = rows.map((_, i) => i).filter((i) => !domains[i]);
  if (unknownIdx.length > 0) {
    const answer = await (deps.chatFn ?? chat)(
      [{ role: "user", content: websitePrompt(unknownIdx.map((i) => names[i])) }],
      { temperature: 0, maxTokens: 800, tier: "fast" },
    );
    const resolved = answer ? parseWebsiteAnswers(answer, unknownIdx.length) : [];
    unknownIdx.forEach((rowI, k) => {
      domains[rowI] = resolved[k] ?? null;
    });
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const domain = domains[i];
    const update: { deepChecked: boolean; website?: string; found?: boolean } = { deepChecked: true };
    if (domain) {
      update.website = domain;
      report.sitesResolved++;
      const scanHits = await scanCompanySite(domain, deps.fetchImpl ?? fetch);
      for (const hit of scanHits.slice(0, 3)) {
        const verified = await verifyScanHit(names[i], hit, deps.probeFn ?? probeBoard);
        if (!verified) continue;
        report.found++;
        update.found = true;
        await prisma.atsBoard.upsert({
          where: { platform_token_region: { platform: verified.platform, token: verified.token, region: verified.region } },
          update: {},
          create: {
            platform: verified.platform,
            token: verified.token,
            region: verified.region,
            companyName: verified.companyName,
            status: "active",
            discoveredVia: "deep-probe",
            validatedAt: new Date(),
          },
        });
        break;
      }
    }
    await prisma.companyProbe.update({ where: { id: row.id }, data: update });
  }
  return report;
}
