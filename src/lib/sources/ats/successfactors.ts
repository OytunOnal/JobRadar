import { getText, postJSON, type RawJob } from "../types";

// SAP SuccessFactors, Career Site Builder generation. Token = the branded
// career-site HOST (jobs.man.eu). Results are LOCALE-GATED (live-verified:
// MAN de_DE=601 vs en_US=8) — the site's /search/ page advertises its locales;
// query each and dedup by id, English first so English titles win.

// The locale list the site advertises, English-first. Pure over the page HTML,
// and the quirk this connector exists for: query one locale and you see a
// twentieth of the board.
export function parseLocales(html: string): string[] {
  const found = [...new Set([...html.matchAll(/locale=([a-z]{2}_[A-Z]{2})/g)].map((m) => m[1]))];
  const locales = found.length ? found : ["en_US", "de_DE"];
  return [...locales].sort((a, b) => Number(b.startsWith("en")) - Number(a.startsWith("en")));
}

export function mapSuccessFactorsRow(row: any, ctx: { token: string; company: string; origin: string; locale: string }): RawJob | null {
  const j = row?.response ?? row;
  if (!j?.id) return null;
  const loc = (j.jobLocationShort ?? []).filter(Boolean).join("; ");
  return {
    source: `sf:${ctx.token}`,
    externalId: String(j.id),
    url: `${ctx.origin}/job/${j.unifiedUrlTitle ?? j.id}/${j.id}-${ctx.locale}`,
    title: String(j.unifiedStandardTitle ?? "").trim(),
    company: ctx.company,
    location: loc,
    remote: /remote|home\s*office/i.test(`${j.unifiedStandardTitle} ${loc}`),
    description: String(j.unifiedStandardTitle ?? ""), // list carries no body
    postedAt: j.unifiedStandardStart ? new Date(j.unifiedStandardStart) : undefined,
  };
}

export async function successfactors(token: string, company: string): Promise<RawJob[]> {
  const origin = `https://${token}`;
  let html = "";
  try {
    html = await getText(`${origin}/search/`);
  } catch {
    /* fall through to defaults */
  }
  const locales = parseLocales(html);

  const seen = new Set<string>();
  const out: RawJob[] = [];
  for (const locale of locales) {
    for (let page = 0; page < 100; page++) {
      const res = await postJSON(`${origin}/services/recruiting/v1/jobs`, {
        keywords: "", locale, location: "", pageNumber: page, sortBy: "recent",
      });
      const rows: any[] = res?.jobSearchResult ?? [];
      for (const row of rows) {
        const job = mapSuccessFactorsRow(row, { token, company, origin, locale });
        if (!job || seen.has(job.externalId)) continue;
        seen.add(job.externalId);
        out.push(job);
      }
      const total = Number(res?.totalJobs ?? 0);
      if (rows.length === 0 || (page + 1) * 10 >= total) break;
    }
  }
  return out;
}
