import type { AtsProvider } from "../sources/ats";

// Registry of ATS platforms the discovery layer understands. Everything the
// engine needs to recognize, validate, and (when a fetcher exists) ingest a
// platform lives in one entry here — adding a platform is data, not code.
//
// Platforms are added one at a time, each grounded against a corpus of real
// URLs (see tests/discovery.test.ts). Currently registered: greenhouse.

// How to pull a board slug out of a URL on this platform.
export type SlugPattern =
  | {
      // Slug is a path segment: boards.greenhouse.io/<slug>/jobs/123
      kind: "path";
      hosts: readonly string[]; // exact hostnames, never wildcards
      pathIndex?: number; // which segment holds the slug (default 0)
      // Segments that must precede the slug (join.com/companies/<slug>);
      // the slug then sits right after the prefix.
      pathPrefix?: readonly string[];
      denySegments?: ReadonlySet<string>; // segments that are never slugs
    }
  | {
      // Slug is a query parameter: boards.greenhouse.io/embed/job_app?for=<slug>
      kind: "query";
      hosts: readonly string[];
      param: string;
    }
  | {
      // Slug is the leftmost host label: <slug>.recruitee.com
      kind: "subdomain";
      suffixes: readonly string[]; // full suffix after the slug label
      denyLabels?: ReadonlySet<string>;
    }
  | {
      // Structured tokens that span host AND path (Workday's tenant + data
      // center + site triple). hostPattern gates which hosts this applies to
      // (the audit uses it too); match returns the raw token or null.
      kind: "custom";
      hostPattern: RegExp;
      match: (url: URL) => string | null;
    };

export interface AtsPlatform {
  id: string;
  patterns: readonly SlugPattern[];
  // Domains to sweep in bulk discovery (Common Crawl / Wayback CDX).
  // Plain hosts sweep "host/*"; entries starting with "*." sweep the whole
  // domain (subdomain-tokened platforms like Recruitee).
  crawlDomains: readonly string[];
  // Preserve the token's original casing (dedupe is always case-insensitive).
  // Needed for platforms whose API paths are case-sensitive (SmartRecruiters).
  keepCase?: boolean;
  // Overrides the default slug charset (see DEFAULT_SLUG_RE in extract.ts),
  // applied to the percent-DECODED, lowercased token. Ashby tokens can carry
  // dots and spaces ("kraken.com", "tools for humanity"). Keep rules ASCII-only
  // so decoded junk still fails.
  tokenRule?: RegExp;
  // Validation probe: 200 = board is live. Region comes from the discovering
  // host (e.g. "eu") for platforms whose API host differs per region.
  probeUrl: (token: string, region: string) => string;
  // Some APIs answer 200 for boards that don't exist (SmartRecruiters returns
  // {totalFound: 0} for any name). When present, this decides liveness from
  // the response; default is simply status === 200.
  probeAlive?: (status: number, body: unknown) => boolean;
  // Non-GET probes (Workday's cxs API 400s on GET and requires a JSON POST).
  // The validation runner must also send probes with redirect: "manual" —
  // some hosts (Personio) 307 dead boards to a healthy marketing page.
  probeRequest?: { method: string; headers?: Record<string, string>; body?: string };
  // Wired to src/lib/sources/ats.ts when implemented; absent = discover-and-park
  // (slugs accumulate and validate, ingest ignores them until a fetcher lands).
  fetcher?: AtsProvider;
}

// Shared deny list for path-kind patterns: infrastructure segments that appear
// on ATS domains but are never board slugs.
export const COMMON_DENY_SEGMENTS: ReadonlySet<string> = new Set([
  "embed", "api", "static", "assets", "images", "img", "js", "css", "fonts",
  "sitemap", "cdn-cgi",
]);

const GREENHOUSE_HOSTS = [
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  // EU data-residency hosts. Verified live: EU boards resolve through the same
  // boards-api.greenhouse.io API (boards-api.eu.* does not exist in DNS), so
  // region is recorded as metadata only.
  "boards.eu.greenhouse.io",
  "job-boards.eu.greenhouse.io",
] as const;

const LEVER_HOSTS = [
  "jobs.lever.co",
  // EU instance. Verified live: the slug namespaces are region-SEPARATE —
  // an EU board 404s on the US API (abzena: eu=200, us=404) — so region is
  // load-bearing here, not just metadata.
  "jobs.eu.lever.co",
] as const;

const leverPlatform: AtsPlatform = {
  id: "lever",
  // URL shape: jobs.lever.co/<slug>/<posting-uuid>[/apply] — slug is segment 0.
  // The API is CASE-SENSITIVE (DREAMGAMES=404, dreamgames=200 — verified live),
  // and real Lever slugs are always lowercase (corpus-checked: every uppercase
  // hit was percent-encoded junk). Lowercasing is therefore required, not just
  // canonical: it repairs sloppily-written links that would otherwise 404.
  patterns: [{ kind: "path", hosts: LEVER_HOSTS, denySegments: COMMON_DENY_SEGMENTS }],
  // jobs.lever.co blocks crawlers via robots.txt, so Common Crawl only ever has
  // its robots.txt (verified). US boards arrive via Wayback/harvest/datasets;
  // listing both hosts here is harmless and future-proof.
  crawlDomains: LEVER_HOSTS,
  probeUrl: (token, region) =>
    region === "eu"
      ? `https://api.eu.lever.co/v0/postings/${token}?mode=json`
      : `https://api.lever.co/v0/postings/${token}?mode=json`,
  // sources/ats.ts lever() accepts the region argument and routes to the
  // matching API host, so EU boards are fetchable end to end.
  fetcher: "lever",
};

// Well-known web files — must be denied on platforms whose token rule allows
// dots, where "robots.txt" would otherwise pass as a slug.
export const WEB_FILE_SEGMENTS: ReadonlySet<string> = new Set([
  "robots.txt", "favicon.ico", "sitemap.xml", "sitemap.txt", "ads.txt",
  "security.txt", "humans.txt", "manifest.json",
]);

// Regional instances: checked live for every registered platform. Greenhouse
// and Lever have .eu. hosts (both registered below); Ashby and SmartRecruiters
// have none (jobs.eu.ashbyhq.com / *.eu.smartrecruiters.com don't resolve).
// Probe discrimination: Greenhouse, Ashby, and Lever all 404 for unknown
// boards, so the default status===200 probe is sound; SmartRecruiters is the
// exception (see its probeAlive).

const ashbyPlatform: AtsPlatform = {
  id: "ashby",
  // URL shape: jobs.ashbyhq.com/<slug>[/<posting-uuid>[/application]].
  // Verified against the CC corpus + live API: tokens may contain uppercase,
  // dots, and spaces ("Crusoe", "kraken.com", "Tools%20for%20Humanity"); the
  // API is case-insensitive for all of them, so lowercase stays canonical.
  patterns: [
    {
      kind: "path",
      hosts: ["jobs.ashbyhq.com"],
      denySegments: new Set([...COMMON_DENY_SEGMENTS, ...WEB_FILE_SEGMENTS]),
    },
  ],
  crawlDomains: ["jobs.ashbyhq.com"],
  tokenRule: /^[a-z0-9][a-z0-9 ._&'-]{0,80}$/,
  // Token may contain spaces/dots — encode it into the probe path.
  probeUrl: (token) =>
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`,
  fetcher: "ashby",
};

const smartrecruitersPlatform: AtsPlatform = {
  id: "smartrecruiters",
  // URL shape: jobs.smartrecruiters.com/<Company>/<id>-<title-slug> plus the
  // hosted career pages at careers.smartrecruiters.com/<Company>. Tokens are
  // CamelCase company names (BoschGroup, VeoliaEnvironnementSA, up to ~47
  // chars in the corpus); the API is case-insensitive (verified live), so
  // lowercase stays canonical and keepCase is unnecessary.
  patterns: [
    {
      kind: "path",
      hosts: ["jobs.smartrecruiters.com", "careers.smartrecruiters.com"],
      denySegments: COMMON_DENY_SEGMENTS,
    },
  ],
  crawlDomains: ["jobs.smartrecruiters.com", "careers.smartrecruiters.com"],
  probeUrl: (token) =>
    `https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=1`,
  // The postings endpoint answers 200 with {totalFound: 0} for ANY name —
  // status alone can't distinguish a dead board from a made-up one. Liveness
  // therefore means "has at least one live posting"; a real company that
  // temporarily has zero openings reads as dead, and the 30-day dead-recheck
  // cycle picks it back up when it posts again.
  probeAlive: (status, body) =>
    status === 200 && typeof body === "object" && body !== null &&
    (body as { totalFound?: number }).totalFound! > 0,
  fetcher: "smartrecruiters",
};

const workablePlatform: AtsPlatform = {
  id: "workable",
  // URL shapes: apply.workable.com/<slug>/ and apply.workable.com/<slug>/j/<code>;
  // bare apply.workable.com/j/<code> job shortlinks carry no account slug, so
  // "j" is denied. Legacy <slug>.workable.com still resolves (301s to apply.*),
  // hence the subdomain pattern. API is CASE-SENSITIVE like Lever (GAMIGO=404,
  // gamigo=200 — verified live); real slugs are lowercase. No EU instance.
  patterns: [
    {
      kind: "path",
      hosts: ["apply.workable.com"],
      denySegments: new Set([...COMMON_DENY_SEGMENTS, ...WEB_FILE_SEGMENTS, "j"]),
    },
    {
      kind: "subdomain",
      suffixes: ["workable.com"],
      denyLabels: new Set([
        "www", "apply", "jobs", "careers", "help", "support", "resources",
        "status", "api", "developers", "blog", "app", "auth", "id", "connect",
        "mail", "marketplace", "partners", "press", "learning",
      ]),
    },
  ],
  crawlDomains: ["apply.workable.com"],
  probeUrl: (token) => `https://apply.workable.com/api/v1/widget/accounts/${token}`,
  fetcher: "workable",
};

// Shared deny list for subdomain-tokened platforms: labels that are always
// infrastructure, never a company board.
export const COMMON_DENY_LABELS: ReadonlySet<string> = new Set([
  "www", "api", "app", "auth", "blog", "careers", "cdn", "docs", "help",
  "mail", "email", "static", "assets", "status", "support", "jobs",
]);

const recruiteePlatform: AtsPlatform = {
  id: "recruitee",
  // Subdomain-tokened: <slug>.recruitee.com with job paths under /o/<job-slug>.
  // Corpus shows digit-leading slugs ("1x", "8advisory") and no deep
  // subdomains. Probe discrimination verified live: unknown subdomain → 404,
  // real board → 200 on /api/offers/ (full JSON incl. descriptions and dates).
  patterns: [
    { kind: "subdomain", suffixes: ["recruitee.com"], denyLabels: COMMON_DENY_LABELS },
  ],
  crawlDomains: ["*.recruitee.com"],
  // Token sits in the HOST position of the probe.
  probeUrl: (token) => `https://${token}.recruitee.com/api/offers/`,
  fetcher: "recruitee",
};

const personioPlatform: AtsPlatform = {
  id: "personio",
  // Subdomain-tokened with a TWO-LABEL suffix: <slug>.jobs.personio.de and
  // <slug>.jobs.personio.com. The namespaces are MIRRORED (verified live:
  // the same slug answers on both suffixes), so no region tracking — one
  // canonical probe on .com covers both. Unknown subdomains do NOT 404: they
  // 307-redirect to marketing, so validation must use redirect: "manual"
  // (a followed redirect reads as a healthy 200).
  patterns: [
    {
      kind: "subdomain",
      suffixes: ["jobs.personio.de", "jobs.personio.com"],
      denyLabels: COMMON_DENY_LABELS,
    },
  ],
  crawlDomains: ["*.jobs.personio.de", "*.jobs.personio.com"],
  probeUrl: (token) => `https://${token}.jobs.personio.com/xml`,
  fetcher: "personio",
};

// Locale path segments on Workday hosts (en-US, de-DE, zh-Hans...).
const WORKDAY_LOCALE_RE = /^[a-z]{2}-[a-z]{2,4}$/i;

function workdaySegs(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
}

const workdayPlatform: AtsPlatform = {
  id: "workday",
  // Token is a STRUCTURED triple — tenant + data center + career site —
  // canonicalized as "tenant@wdN/site". Two URL shapes feed it (verified live
  // that both converge: a myworkdaysite-discovered tenant answers on the
  // canonical myworkdayjobs cxs endpoint):
  //   <tenant>.wdN.myworkdayjobs.com/[<locale>/]<site>/job/...
  //   wdN.myworkdaysite.com/[<locale>/]recruiting/<tenant>/<site>/job/...
  // The cxs API is case-insensitive on the site (verified), so the whole
  // token lowercases. Unknown site → 404, unknown tenant → 406: default
  // status probe discriminates, but the probe must be a JSON POST (GET=400).
  patterns: [
    {
      kind: "custom",
      hostPattern: /(^|\.)wd\d+\.(myworkdayjobs|myworkdaysite)\.com$/,
      match: (url) => {
        const segs = workdaySegs(url);
        let m = url.hostname.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
        if (m) {
          let i = 0;
          if (segs[i] && WORKDAY_LOCALE_RE.test(segs[i])) i++;
          const site = segs[i];
          if (!site || site === "wday" || site === "job") return null;
          return `${m[1]}@${m[2]}/${site}`;
        }
        m = url.hostname.match(/^(wd\d+)\.myworkdaysite\.com$/);
        if (m) {
          let i = 0;
          if (segs[i] && WORKDAY_LOCALE_RE.test(segs[i])) i++;
          if (segs[i] !== "recruiting") return null;
          const tenant = segs[i + 1];
          const site = segs[i + 2];
          if (!tenant || !site || site === "job" || site === "wday") return null;
          return `${tenant}@${m[1]}/${site}`;
        }
        return null;
      },
    },
  ],
  crawlDomains: ["*.myworkdayjobs.com", "*.myworkdaysite.com"],
  tokenRule: /^[a-z0-9][a-z0-9-]*@wd\d+\/[a-z0-9_.-]+$/,
  probeUrl: (token) => {
    const m = token.match(/^([^@]+)@(wd\d+)\/(.+)$/);
    if (!m) return "";
    return `https://${m[1]}.${m[2]}.myworkdayjobs.com/wday/cxs/${m[1]}/${m[3]}/jobs`;
  },
  probeRequest: {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ limit: 1, offset: 0, searchText: "", appliedFacets: {} }),
  },
  fetcher: "workday",
};

// ── Discover-and-park platforms (no fetcher yet) ─────────────────────────────
// Slugs accumulate and validate; ingest ignores them until a fetcher lands.

const bamboohrPlatform: AtsPlatform = {
  id: "bamboohr",
  // <sub>.bamboohr.com with career pages under /careers. Probe verified live:
  // /careers/list answers 200 + JSON when the career site is enabled; disabled
  // or unknown subdomains 302 to www.bamboohr.com — probe must use
  // redirect: "manual" and 302 reads as dead.
  patterns: [
    {
      kind: "subdomain",
      suffixes: ["bamboohr.com"],
      denyLabels: new Set([...COMMON_DENY_LABELS, "documentation"]),
    },
  ],
  crawlDomains: ["*.bamboohr.com"],
  probeUrl: (token) => `https://${token}.bamboohr.com/careers/list`,
  fetcher: "bamboohr",
};

const breezyPlatform: AtsPlatform = {
  id: "breezy",
  // <sub>.breezy.hr with job paths under /p/<id>-<title>. Probe verified live:
  // /json answers 200 for real boards; unknown subdomains 302 (dead under
  // redirect: "manual").
  patterns: [
    {
      kind: "subdomain",
      suffixes: ["breezy.hr"],
      denyLabels: COMMON_DENY_LABELS,
    },
  ],
  crawlDomains: ["*.breezy.hr"],
  probeUrl: (token) => `https://${token}.breezy.hr/json`,
  fetcher: "breezy",
};

const teamtailorPlatform: AtsPlatform = {
  id: "teamtailor",
  // <sub>.teamtailor.com hosted boards (tjintokk, huaweidusseldorf-1719303222).
  // KNOWN LIMIT: most Teamtailor customers CNAME a custom career domain, which
  // no host pattern can catch — this entry only sees the *.teamtailor.com
  // minority. Probe verified live: /jobs answers 200, unknown subdomains 404.
  patterns: [
    {
      kind: "subdomain",
      suffixes: ["teamtailor.com"],
      denyLabels: new Set([...COMMON_DENY_LABELS, "integrations"]),
    },
  ],
  crawlDomains: ["*.teamtailor.com"],
  probeUrl: (token) => `https://${token}.teamtailor.com/jobs`,
  fetcher: "teamtailor",
};

const joinPlatform: AtsPlatform = {
  id: "join",
  // Path-tokened with a required prefix: join.com/companies/<slug>[/<job>].
  // Probe verified live: company page answers 200, unknown slugs 404.
  patterns: [
    {
      kind: "path",
      hosts: ["join.com", "www.join.com"],
      pathPrefix: ["companies"],
      denySegments: COMMON_DENY_SEGMENTS,
    },
  ],
  crawlDomains: ["join.com/companies"],
  probeUrl: (token) => `https://join.com/companies/${token}`,
  fetcher: "join",
};

const pinpointPlatform: AtsPlatform = {
  id: "pinpoint",
  // <slug>.pinpointhq.com hosted boards (xeneta). Probe verified live
  // 2026-08: /postings.json answers 200 JSON, unknown subdomains 404 with no
  // redirect, uppercase slugs answer 200 (case-insensitive). The payload is
  // rich: full description AND a compensation string.
  patterns: [
    {
      kind: "subdomain",
      suffixes: ["pinpointhq.com"],
      denyLabels: COMMON_DENY_LABELS,
    },
  ],
  crawlDomains: ["*.pinpointhq.com"],
  probeUrl: (token) => `https://${token}.pinpointhq.com/postings.json`,
  fetcher: "pinpoint",
};

const oraclePlatform: AtsPlatform = {
  id: "oracle",
  // Oracle Cloud Recruiting. Structured token "<hostPrefix>@<site>" — e.g.
  // eeho.fa.us2@CX_45001. URL shape:
  //   <prefix>.oraclecloud.com/hcmUI/CandidateExperience/<locale>/sites/<site>/...
  // Live-verified 2026-08-21 on Oracle's own board (2,136 postings): the CE
  // REST list API is public JSON, no auth. QUIRK: an unknown siteNumber does
  // NOT 404 — the API silently serves the tenant's default site — so
  // probeAlive requires a non-empty requisitionList, and a wrong site token
  // yields duplicate (not wrong) jobs, which contentKey dedup absorbs.
  patterns: [
    {
      kind: "custom",
      hostPattern: /\.oraclecloud\.com$/,
      match: (url) => {
        const m = url.hostname.match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)*)\.oraclecloud\.com$/i);
        if (!m) return null;
        const segs = url.pathname.split("/").filter(Boolean);
        const si = segs.findIndex((s) => s.toLowerCase() === "sites");
        if (si === -1 || !segs[si + 1]) return null;
        if (segs[0]?.toLowerCase() !== "hcmui") return null;
        return `${m[1]}@${segs[si + 1]}`;
      },
    },
  ],
  crawlDomains: ["*.oraclecloud.com"],
  tokenRule: /^[a-z0-9][a-z0-9.-]*@[a-z0-9_-]+$/,
  probeUrl: (token) => {
    const m = token.match(/^([^@]+)@(.+)$/);
    if (!m) return "";
    return (
      `https://${m[1]}.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true` +
      `&finder=findReqs;siteNumber=${encodeURIComponent(m[2])},limit=1,offset=0`
    );
  },
  probeAlive: (status, body) => {
    if (status !== 200 || typeof body !== "object" || body === null) return false;
    const item = (body as any).items?.[0];
    return Array.isArray(item?.requisitionList) && item.requisitionList.length > 0;
  },
  fetcher: "oracle",
};

const eightfoldPlatform: AtsPlatform = {
  id: "eightfold",
  // <tenant>.eightfold.ai; branded CNAMEs front the same host. Live-verified
  // quirk: tenants that haven't enabled the public career-site API answer
  // 403 "Not authorized for PCSX" — dead for our purposes, hence the
  // positions-based probeAlive.
  patterns: [
    {
      kind: "subdomain",
      suffixes: ["eightfold.ai"],
      denyLabels: new Set([...COMMON_DENY_LABELS, "app", "apply", "developer"]),
    },
  ],
  crawlDomains: ["*.eightfold.ai"],
  probeUrl: (token) => `https://${token}.eightfold.ai/api/apply/v2/jobs?start=0&num=1`,
  probeAlive: (status, body) =>
    status === 200 && Array.isArray((body as any)?.positions) && (body as any).positions.length > 0,
  fetcher: "eightfold",
};

const jibePlatform: AtsPlatform = {
  id: "jibe",
  // <slug>.jibeapply.com — iCIMS' career-site layer, clean public JSON with
  // full descriptions. Unknown slugs fail DNS (no wildcard).
  patterns: [
    { kind: "subdomain", suffixes: ["jibeapply.com"], denyLabels: COMMON_DENY_LABELS },
  ],
  crawlDomains: ["*.jibeapply.com"],
  probeUrl: (token) => `https://${token}.jibeapply.com/api/jobs?page=1`,
  fetcher: "jibe",
};

const beesitePlatform: AtsPlatform = {
  id: "beesite",
  // <tenant>.app.beesite.de backends (milch & zucker); the branded career
  // sites reference this host in their HTML, which is how harvest finds it.
  patterns: [
    { kind: "subdomain", suffixes: ["app.beesite.de"], denyLabels: COMMON_DENY_LABELS },
  ],
  crawlDomains: ["*.app.beesite.de"],
  probeUrl: (token) =>
    `https://${token}.app.beesite.de/search?data=${encodeURIComponent(
      JSON.stringify({
        LanguageCode: "EN",
        SearchParameters: { FirstItem: 1, CountItem: 1, MatchedObjectDescriptor: ["PositionID"] },
        SearchCriteria: [],
      }),
    )}`,
  probeAlive: (status, body) =>
    status === 200 && Number((body as any)?.SearchResult?.SearchResultCountAll ?? 0) > 0,
  fetcher: "beesite",
};

const ripplingPlatform: AtsPlatform = {
  id: "rippling",
  // ats.rippling.com/<slug>/jobs — path-tokened. Unknown slugs 404 on the
  // board API (RESOURCE_NOT_FOUND), so the default status probe is sound.
  patterns: [
    {
      kind: "path",
      hosts: ["ats.rippling.com"],
      denySegments: COMMON_DENY_SEGMENTS,
    },
  ],
  crawlDomains: ["ats.rippling.com"],
  probeUrl: (token) => `https://api.rippling.com/platform/api/ats/v1/board/${token}/jobs`,
  fetcher: "rippling",
};

export const platforms: readonly AtsPlatform[] = [
  {
    id: "greenhouse",
    patterns: [
      { kind: "path", hosts: GREENHOUSE_HOSTS, denySegments: COMMON_DENY_SEGMENTS },
      // Career-site embeds: boards.greenhouse.io/embed/job_app?for=<slug>
      { kind: "query", hosts: GREENHOUSE_HOSTS, param: "for" },
    ],
    crawlDomains: GREENHOUSE_HOSTS,
    // Board ROOT, not /jobs: same 200/404 discrimination (verified live), a
    // far smaller payload, and the body carries the company name.
    probeUrl: (token) => `https://boards-api.greenhouse.io/v1/boards/${token}`,
    fetcher: "greenhouse",
  },
  leverPlatform,
  ashbyPlatform,
  smartrecruitersPlatform,
  workablePlatform,
  recruiteePlatform,
  personioPlatform,
  workdayPlatform,
  bamboohrPlatform,
  breezyPlatform,
  pinpointPlatform,
  teamtailorPlatform,
  joinPlatform,
  oraclePlatform,
  eightfoldPlatform,
  jibePlatform,
  beesitePlatform,
  ripplingPlatform,
];

export function getPlatform(id: string): AtsPlatform | undefined {
  return platforms.find((p) => p.id === id);
}
