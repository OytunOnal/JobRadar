// Shared schema.org helpers for sitemap-fed boards whose detail pages carry
// JobPosting JSON-LD. Two users at birth (nextleveljobs, freework); the
// third would have copied them, and desc-fill already grew its own private
// jsonLdDescription — this is the read-side twin, kept small on purpose.

export interface SitemapEntry {
  url: string;
  lastmod: string;
}

/** Job-posting URLs from a sitemap, newest lastmod first. `pattern` says
 * which URLs are postings — boards mix filter pages into the same file
 * (Free-Work's tech sitemap opens with two query-string filter URLs). */
export function parseJobSitemap(xml: string, pattern: RegExp): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const m of xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:[\s\S]*?<lastmod>([^<]+)<\/lastmod>)?[\s\S]*?<\/url>/g)) {
    if (pattern.test(m[1]!)) out.push({ url: m[1]!, lastmod: m[2] ?? "" });
  }
  return out.sort((a, b) => b.lastmod.localeCompare(a.lastmod));
}

/** The first JobPosting node in the page's ld+json blocks, or null. */
export function extractJobPostingLd(html: string): any | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(m[1]!);
      for (const node of Array.isArray(data) ? data : [data]) {
        if (node?.["@type"] === "JobPosting") return node;
        for (const inner of node?.["@graph"] ?? []) {
          if (inner?.["@type"] === "JobPosting") return inner;
        }
      }
    } catch { /* malformed block — next */ }
  }
  return null;
}
