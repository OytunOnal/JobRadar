import { platforms, type AtsPlatform, type SlugPattern } from "./platforms";

// Turns any URL into an ATS board candidate: (platform, token) or null.
// Every discovery source (harvest, Common Crawl, Wayback, datasets) produces
// URLs; this is the single place that knows what a board slug looks like.
//
// Bias: lean toward recall. A false candidate costs one validation probe;
// a missed slug is a company we never see. Hosts are matched exactly, though —
// the leniency lives in the path/charset rules only.

export interface SlugHit {
  platform: string;
  token: string; // canonical form (original case only when platform.keepCase)
  dedupeToken: string; // always lowercase — identity for storage/dedupe
  region: string; // "" or e.g. "eu", derived from the matched host
  host: string;
}

// Default slug charset: start alphanumeric, then alphanumerics, hyphens,
// underscores. Platforms whose real tokens are looser override this via
// tokenRule (Ashby allows dots and spaces) — rules stay ASCII-only so
// percent-decoded junk always fails.
export const DEFAULT_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

// API version segments (v1, v2...) masquerade as slugs on some domains.
// Deny exactly these — NOT every v-prefixed token (vercel, voodoo are real).
const VERSION_RE = /^v\d+$/;

function regionOf(host: string): string {
  // Regional ATS hosts follow a ".<region>." infix convention, e.g.
  // boards.eu.greenhouse.io / jobs.eu.lever.co. Applies to exact-host patterns
  // only, so a company subdomain can never trigger it.
  const m = host.match(/\.(eu)\./);
  return m ? m[1] : "";
}

function validToken(raw: string, rule: RegExp): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null; // malformed percent-encoding
  }
  const lower = decoded.toLowerCase();
  if (!rule.test(lower)) return null;
  if (VERSION_RE.test(lower)) return null;
  return decoded;
}

function tryPattern(p: SlugPattern, url: URL, rule: RegExp): string | null {
  const host = url.hostname;
  switch (p.kind) {
    case "path": {
      if (!p.hosts.includes(host)) return null;
      const segments = url.pathname.split("/").filter(Boolean);
      let idx = p.pathIndex ?? 0;
      if (p.pathPrefix) {
        for (let i = 0; i < p.pathPrefix.length; i++) {
          if (segments[i]?.toLowerCase() !== p.pathPrefix[i]) return null;
        }
        idx = p.pathPrefix.length;
      }
      const raw = segments[idx];
      if (!raw) return null;
      if (p.denySegments?.has(raw.toLowerCase())) return null;
      return validToken(raw, rule);
    }
    case "query": {
      if (!p.hosts.includes(host)) return null;
      const raw = url.searchParams.get(p.param);
      if (!raw) return null;
      return validToken(raw, rule);
    }
    case "subdomain": {
      for (const suffix of p.suffixes) {
        if (!host.endsWith("." + suffix)) continue;
        const front = host.slice(0, -(suffix.length + 1));
        // Exactly one label before the suffix — nested subdomains are
        // infrastructure (e.g. cdn.foo.recruitee.com), not boards.
        if (front.includes(".")) return null;
        if (p.denyLabels?.has(front)) return null;
        return validToken(front, rule);
      }
      return null;
    }
    case "custom": {
      if (!p.hostPattern.test(host)) return null;
      const raw = p.match(url);
      if (raw === null) return null;
      return validToken(raw, rule);
    }
  }
}

export function extractSlug(rawUrl: string): SlugHit | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  // Rebuild with the lowercased host so pattern host checks are exact.
  url.hostname = host;

  for (const platform of platforms) {
    for (const pattern of platform.patterns) {
      const token = tryPattern(pattern, url, platform.tokenRule ?? DEFAULT_SLUG_RE);
      if (token === null) continue;
      const canonical = platform.keepCase ? token : token.toLowerCase();
      return {
        platform: platform.id,
        token: canonical,
        dedupeToken: token.toLowerCase(),
        region: regionOf(host),
        host,
      };
    }
  }
  return null;
}

// Guard used by tests: every exact host must belong to at most one platform,
// so extraction order can never change a result.
export function hostCollisions(): string[] {
  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const p of platforms) {
    for (const pat of p.patterns) {
      // Custom patterns gate on a host regex, not a static list; their
      // domains are structurally distinct so the static check skips them.
      if (pat.kind === "custom") continue;
      const hosts = pat.kind === "subdomain" ? pat.suffixes : pat.hosts;
      for (const h of hosts) {
        const owner = seen.get(h);
        if (owner && owner !== p.id) collisions.push(`${h}: ${owner} vs ${p.id}`);
        seen.set(h, p.id);
      }
    }
  }
  return collisions;
}

export type { AtsPlatform };
