import { profileSearchGroups } from "../profile";
import { type RawJob, type Source } from "./types";

// VDAB — Flanders' public employment service (vdab.be), Belgium's biggest
// vacancy pool. The REST API needs a `vej-key-monitor` header: a build-time
// constant baked into VDAB's own frontend bundle (not a per-visitor token;
// works from a cold request). If VDAB rotates it on a redeploy, the current
// key is re-read from the live bundle on a 403 — self-healing, no code
// change. (Contract learned from career-ops' vdab provider.)
//
// Search: EN + NL + FR leads (Flanders posts Dutch, Brussels French, tech
// often English). Server-side recency window via onlineSindsCode.
//
// Config: VDAB_WINDOW_DAYS (7)  VDAB_MAX_PAGES (3, x100/page)

const API_URL = "https://www.vdab.be/rest/vindeenjob/v4/vacatureLight/zoek";
const DETAIL_BASE = "https://www.vdab.be/vindeenjob/vacatures/";
const DEFAULT_KEY = "b277002f-e1fa-4fc5-868a-fdab633c3851";
const UA = "Mozilla/5.0 (compatible; JobRadar/0.1; personal job search)";
const WINDOW_DAYS = Number(process.env.VDAB_WINDOW_DAYS) || 7;
const MAX_PAGES = Number(process.env.VDAB_MAX_PAGES) || 3;
const SIZE = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// NOTE: `pagina` is ZERO-indexed — live-verified: pagina 1 with a 100-row
// page returned an empty page for a 63-hit query (totaalAantal said 63).
export function buildSearchBody(trefwoord: string, pagina: number): object {
  return {
    criteria: {
      trefwoord,
      diplomaCodes: [], arbeidsduurCodes: [], arbeidsregimeCodes: [],
      contractTypeCodes: [], jobdomeinCodes: [], internationaalCodes: [],
      beroepCodes: [], ervaringCodes: [], rijbewijsCodes: [], attestCodes: [],
      taalCriteria: { taalSelecties: [] },
      onlineSindsCode: String(WINDOW_DAYS),
      sorteerVeld: "STANDAARD",
    },
    pagina,
    zoekmodus: "C2",
    paginaGrootte: SIZE,
  };
}

// Live-verified result shape: { id: {id}, vacaturefunctie: {naam},
// vacatureBedrijfsnaam, tewerkstellingsLocatieRegioOfAdres, gesloten }.
export function mapResult(r: any): RawJob | null {
  const id = r?.id?.id ?? r?.id;
  const title = String(r?.vacaturefunctie?.naam ?? r?.vacaturefunctie ?? "").trim();
  if (!id || !title || title === "[object Object]" || r?.gesloten === true) return null;
  const rawLoc = r.tewerkstellingsLocatieRegioOfAdres ?? r.locatie;
  const loc = typeof rawLoc === "string" ? rawLoc : String(rawLoc?.naam ?? "");
  return {
    source: "vdab",
    externalId: String(id),
    url: `${DETAIL_BASE}${id}`,
    title,
    company: String(r.vacatureBedrijfsnaam ?? "").trim(),
    location: loc ? `${loc}, Belgium` : "Belgium",
    remote: false, // location-bound national board; deriveWorkMode reads text
    description: title, // light search payload has no body — title scoring
    postedAt: r.eerstePublicatieDatum ? new Date(r.eerstePublicatieDatum) : undefined,
  };
}

async function rederiveKey(fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl("https://www.vdab.be/vindeenjob/vacatures", {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await res.text();
    const bundleUrl = html.match(/https:\/\/www\.vdab\.be\/webapps\/vindeenjob\/main-[\w-]+\.js/)?.[0];
    if (!bundleUrl) return null;
    const js = await (await fetchImpl(bundleUrl, { signal: AbortSignal.timeout(20_000) })).text();
    return js.match(/vej-key-monitor","([0-9a-f-]{36})"/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function fetchVdab(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  let key = DEFAULT_KEY;
  const search = async (body: object): Promise<any | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchImpl(API_URL, {
          method: "POST",
          headers: {
            "User-Agent": UA, "Content-Type": "application/json",
            Accept: "application/json", "vej-key-monitor": key,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 403 && attempt === 0) {
          const fresh = await rederiveKey(fetchImpl); // rotated on redeploy?
          if (!fresh) return null;
          key = fresh;
          continue;
        }
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }
    return null;
  };

  const titles = new Set<string>();
  for (const g of profileSearchGroups(4)) {
    titles.add(g.en[0]);
    if (g.nl?.[0]) titles.add(g.nl[0]);
    if (g.fr?.[0]) titles.add(g.fr[0]);
  }

  const out: RawJob[] = [];
  const seen = new Set<string>();
  for (const q of titles) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await search(buildSearchBody(q, page));
      const results: any[] = data?.resultaten ?? [];
      for (const r of results) {
        const job = mapResult(r);
        if (!job || seen.has(job.externalId)) continue;
        seen.add(job.externalId);
        out.push(job);
      }
      await sleep(400);
      if (results.length < SIZE) break;
    }
  }
  return out;
}

export const vdab: Source = {
  name: "vdab",
  fetch: () => fetchVdab(),
};
