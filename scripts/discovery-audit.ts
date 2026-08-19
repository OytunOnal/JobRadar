// Discovery audit: full accounting of a URL corpus against the slug extractor.
//
// Every URL must end up in exactly one bucket:
//   matched      — extractor produced a (platform, slug)
//   known-junk   — rejected for a reason we can name (robots.txt, root, embed
//                  shell without ?for=, version/deny segments, bad charset)
//   foreign-host — host belongs to no registered platform (mixed/dirty dumps)
//   UNEXPLAINED  — host is ours, rejection reason unknown → possible pattern gap
//
// Any UNEXPLAINED lines mean the patterns may be missing slugs: the script
// prints samples plus a histogram of the offending first path segments and
// exits 1, so it can gate CI or a manual pre-flight before a discovery run.
//
// Usage:
//   npm run discovery:audit -- <dump-file...>
// Dump lines may be CDX JSON ({"url": "..."}) or plain URLs; blanks ignored.

import { readFileSync } from "node:fs";
import { DEFAULT_SLUG_RE, extractSlug } from "../src/lib/discovery/extract";
import { platforms } from "../src/lib/discovery/platforms";

const KNOWN_JUNK: ReadonlyArray<[string, RegExp]> = [
  ["robots.txt", /\/robots\.txt(\?|$)/i],
  ["favicon", /\/favicon\.[a-z]+(\?|$)/i],
  ["sitemap", /\/sitemap[^/]*\.(xml|txt)(\.gz)?(\?|$)/i],
];

// Junk path segments the extractor rejects by rule (deny lists, version
// segments, decode failures). Re-derived here only to *name* the reason.
const VERSION_RE = /^v\d+$/i;

function platformHosts(): { exact: Set<string>; suffixes: string[]; custom: RegExp[] } {
  const exact = new Set<string>();
  const suffixes: string[] = [];
  const custom: RegExp[] = [];
  for (const p of platforms) {
    for (const pat of p.patterns) {
      if (pat.kind === "subdomain") suffixes.push(...pat.suffixes);
      else if (pat.kind === "custom") custom.push(pat.hostPattern);
      else for (const h of pat.hosts) exact.add(h);
    }
  }
  return { exact, suffixes, custom };
}

function isOurHost(host: string, hosts: ReturnType<typeof platformHosts>): boolean {
  if (hosts.exact.has(host)) return true;
  if (hosts.suffixes.some((s) => host === s || host.endsWith("." + s))) return true;
  return hosts.custom.some((re) => re.test(host));
}

function firstSegment(url: URL): string | null {
  return url.pathname.split("/").filter(Boolean)[0] ?? null;
}

function classifyRejection(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "unparseable";
  }
  for (const [name, re] of KNOWN_JUNK) if (re.test(url.pathname)) return name;

  // Exact-host (path/query) platforms: name segment-level rejections. The
  // "root" reason only exists here — on subdomain-tokened platforms the path
  // is irrelevant and rejections must be explained at the host level below.
  let exactHost = false;
  let tokenRule = DEFAULT_SLUG_RE;
  for (const p of platforms) {
    for (const pat of p.patterns) {
      if (pat.kind !== "path" && pat.kind !== "query") continue;
      if (!pat.hosts.includes(url.hostname)) continue;
      exactHost = true;
      tokenRule = p.tokenRule ?? DEFAULT_SLUG_RE;
    }
  }
  if (exactHost) {
    const seg = firstSegment(url);
    if (seg === null) return "root";
    // Prefix-gated platforms (join.com/companies/<slug>): URLs outside the
    // prefix are ordinary site pages, not pattern gaps.
    let hasPrefix = false;
    let prefixMatched = false;
    let prefixLen = 0;
    const segsAll = url.pathname.split("/").filter(Boolean);
    for (const p of platforms) {
      for (const pat of p.patterns) {
        if (pat.kind !== "path" || !pat.hosts.includes(url.hostname) || !pat.pathPrefix) continue;
        hasPrefix = true;
        if (pat.pathPrefix.every((x, i) => segsAll[i]?.toLowerCase() === x)) {
          prefixMatched = true;
          prefixLen = pat.pathPrefix.length;
        }
      }
    }
    if (hasPrefix) {
      if (!prefixMatched) return "off-prefix";
      const cand = segsAll[prefixLen];
      if (cand === undefined) return "prefix-root";
      // Rejection happened on the slug candidate after the prefix.
      const candLower = (() => {
        try {
          return decodeURIComponent(cand).toLowerCase();
        } catch {
          return null;
        }
      })();
      if (candLower === null) return "bad-encoding";
      if (!tokenRule.test(candLower)) return "bad-charset";
      return null;
    }
    const segLower = (() => {
      try {
        return decodeURIComponent(seg).toLowerCase();
      } catch {
        return null;
      }
    })();
    if (segLower === null) return "bad-encoding";
    for (const p of platforms) {
      for (const pat of p.patterns) {
        if (pat.kind !== "path" || !pat.hosts.includes(url.hostname)) continue;
        if (pat.denySegments?.has(segLower)) return `deny:${segLower}`;
      }
    }
    if (VERSION_RE.test(segLower)) return "version-segment";
    if (!tokenRule.test(segLower)) return "bad-charset";
    return null; // host is ours, segment looks slug-like, yet no match → gap
  }

  // Custom-pattern hosts (Workday): name the structural rejections.
  for (const p of platforms) {
    for (const pat of p.patterns) {
      if (pat.kind !== "custom" || !pat.hostPattern.test(url.hostname)) continue;
      const segs = url.pathname.split("/").filter(Boolean);
      if (segs.length === 0) return "root";
      if (segs.includes("wday")) return "deny:wday";
      const afterLocale = /^[a-z]{2}-[a-z]{2,4}$/i.test(segs[0]) ? segs.slice(1) : segs;
      if (afterLocale.length === 0) return "locale-root";
      // myworkdaysite shape that stops before tenant/site
      if (afterLocale[0] === "recruiting" && afterLocale.length < 3) return "incomplete-path";
      // Site segment with characters no real site uses (glued CDX records etc.)
      const site = afterLocale[0] === "recruiting" ? afterLocale[2] : afterLocale[0];
      if (site && /[^a-zA-Z0-9_.\-]/.test(site)) return "bad-charset";
      return null; // structure looks extractable, yet no token → gap
    }
  }

  // Subdomain-tokened platforms: name host-level rejections.
  for (const p of platforms) {
    for (const pat of p.patterns) {
      if (pat.kind !== "subdomain") continue;
      for (const s of pat.suffixes) {
        if (url.hostname === s) return "apex-domain";
        if (!url.hostname.endsWith("." + s)) continue;
        const front = url.hostname.slice(0, -(s.length + 1));
        if (front.includes(".")) return "nested-subdomain";
        if (pat.denyLabels?.has(front)) return `deny-label:${front}`;
        if (VERSION_RE.test(front)) return "version-segment";
        if (!(p.tokenRule ?? DEFAULT_SLUG_RE).test(front)) return "bad-charset";
      }
    }
  }
  return null;
}

function parseLine(line: string): string | null {
  const t = line.trim();
  if (!t) return null;
  if (t.startsWith("{")) {
    try {
      const u = JSON.parse(t).url;
      return typeof u === "string" ? u : null;
    } catch {
      return null;
    }
  }
  if (/^https?:\/\//i.test(t)) return t;
  return null;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: npm run discovery:audit -- <dump-file...>");
  process.exit(2);
}

const hosts = platformHosts();
let anyUnexplained = false;

for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  const tokensByPlatform = new Map<string, Set<string>>();
  let matched = 0;
  let foreign = 0;
  const junk = new Map<string, number>();
  const unexplained: string[] = [];
  const unexplainedSegs = new Map<string, number>();
  let total = 0;

  for (const line of lines) {
    const raw = parseLine(line);
    if (!raw) continue;
    total++;

    const hit = extractSlug(raw);
    if (hit) {
      matched++;
      let set = tokensByPlatform.get(hit.platform);
      if (!set) tokensByPlatform.set(hit.platform, (set = new Set()));
      set.add(`${hit.dedupeToken}${hit.region ? `@${hit.region}` : ""}`);
      continue;
    }

    let host = "";
    try {
      host = new URL(raw).hostname.toLowerCase();
    } catch {
      junk.set("unparseable", (junk.get("unparseable") ?? 0) + 1);
      continue;
    }
    if (!isOurHost(host, hosts)) {
      foreign++;
      continue;
    }
    const reason = classifyRejection(raw);
    if (reason) {
      junk.set(reason, (junk.get(reason) ?? 0) + 1);
    } else {
      anyUnexplained = true;
      if (unexplained.length < 20) unexplained.push(raw);
      const seg = firstSegment(new URL(raw)) ?? "(root)";
      unexplainedSegs.set(seg, (unexplainedSegs.get(seg) ?? 0) + 1);
    }
  }

  console.log(`\n=== ${file}`);
  console.log(`URLs: ${total} | matched: ${matched} | foreign-host: ${foreign}`);
  for (const [p, set] of tokensByPlatform) console.log(`  ${p}: ${set.size} unique slugs`);
  if (junk.size) {
    const parts = [...junk.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`);
    console.log(`known-junk: ${parts.join(", ")}`);
  }
  const unexplainedTotal = [...unexplainedSegs.values()].reduce((a, b) => a + b, 0);
  if (unexplainedTotal) {
    console.log(`UNEXPLAINED: ${unexplainedTotal} — possible pattern gaps!`);
    const top = [...unexplainedSegs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    for (const [seg, n] of top) console.log(`  segment "${seg}" x${n}`);
    for (const u of unexplained) console.log(`  e.g. ${u.slice(0, 120)}`);
  } else {
    console.log("UNEXPLAINED: 0 — full accounting, no pattern gaps detected");
  }
}

process.exitCode = anyUnexplained ? 1 : 0;
