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

/** The first JobPosting node in the page's ld+json blocks, or null.
 *
 * When the posting's hiringOrganization is an @id REFERENCE rather than an
 * inline object, the organisation's name may be a separate node in the same
 * @graph; resolveOrg pulls it in so callers see one shape. (When the graph
 * does not actually contain that node — CV Keskus points at an Organization
 * id that is not published — the reference stays unresolved and the caller
 * treats the posting as employer-less, which is the honest outcome.) */
export function extractJobPostingLd(html: string): any | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(escapeControlsInStrings(m[1]!));
      for (const node of Array.isArray(data) ? data : [data]) {
        const graph: any[] = node?.["@graph"] ?? [];
        if (node?.["@type"] === "JobPosting") return resolveOrg(node, graph);
        for (const inner of graph) {
          if (inner?.["@type"] === "JobPosting") return resolveOrg(inner, graph);
        }
      }
    } catch { /* malformed beyond repair — next block */ }
  }
  return null;
}

function resolveOrg(posting: any, graph: any[]): any {
  const ref = posting?.hiringOrganization?.["@id"];
  if (!ref || posting.hiringOrganization?.name) return posting;
  const org = graph.find((n) => n?.["@id"] === ref && n?.name);
  return org ? { ...posting, hiringOrganization: org } : posting;
}

// Raw control characters inside string literals are invalid JSON, and real
// boards ship them anyway: Optius's JobPosting block carries literal newlines
// inside jobBenefits, which made an entire Slovenian board look as though it
// had no structured data at all — three ld+json blocks on the page, and the
// only one that mattered failed to parse.
//
// They cannot be stripped blindly, because the same characters are legal
// WHITESPACE between tokens in pretty-printed JSON. So this walks the text
// once and escapes them only while inside a string, leaving formatting alone.
export function escapeControlsInStrings(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of raw) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (inString && ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && ch < " ") {
      out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t" : " ";
      continue;
    }
    out += ch;
  }
  return out;
}
