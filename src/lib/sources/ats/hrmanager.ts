import { getJSON, stripHtml, type RawJob } from "../types";

// HR-Manager (Talentech) — the Nordic ATS family, registered after the
// Nordics scan (#28, docs/scan-parts/denmark.md) turned a parked lead into a
// verified door. Boards live behind one unauthenticated endpoint per tenant
// alias: api.hr-manager.net/jobportal.svc/{alias}/positionlist/json/.
//
// Two properties earned it the registry slot, both verified live 2026-09-03:
//
//   * ALIAS VERIFICATION IS FREE. A real tenant answers 200 with its
//     CustomerName ("dsb" -> "DSB"); a non-tenant answers HTTP 400, not a
//     soft 200 (netcompany, kmd, tv2, coop all 400). Name and liveness in one
//     unauthenticated call is exactly the VERIFIABLE_PLATFORMS contract, so
//     the name probe can guess aliases honestly — no gh:peak ambiguity.
//   * THE LIST CARRIES FULL BODIES. Advertisements[0].Content is the whole
//     ad HTML, so postings arrive readable with no desc:fill debt (the
//     manatal property).
//
// Measured before shipping, on 223 real Nordic companies from our own pool:
// 8 were tenants (3.6%, the sponsor-register lane's rate), 4 with live ads.
// No central directory of aliases exists — the scan checked; /jobportal.svc/
// and /jobportal.svc/customers both 404 — so guessing from company names is
// the only way in, which is precisely what the name probe does.
//
// Field notes for the mapper, all learned by reading a live payload:
//   * The position TITLE is `Name`. Department objects also carry `Name`,
//     which is why a naive scan of the XML looks title-less; the JSON's
//     top-level Items[].Name is the title.
//   * `Published` is .NET's /Date(ms+offset)/, not ISO.
//   * `take=100` returns the whole board (the default page is 25).
//   * AdvertisementUrl is the apply link and the only per-position URL the
//     API exposes; it carries the ProjectId that identifies the posting.

const MAX = Number(process.env.HRMANAGER_MAX) || 100;

// .NET's /Date(1787911491000+0200)/ — the epoch millis are authoritative and
// the offset is presentation, so the millis alone give the right instant.
export function parseDotNetDate(raw: unknown): Date | undefined {
  const ms = String(raw ?? "").match(/\/Date\((-?\d+)/)?.[1];
  if (!ms) return undefined;
  const d = new Date(Number(ms));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function mapHrManagerJob(p: any, token: string, company: string): RawJob | null {
  const id = String(p?.Id ?? "").trim();
  const title = String(p?.Name ?? "").trim();
  if (!id || !title) return null;
  const city = String(p?.PositionLocation?.Name ?? "").trim();
  const body = stripHtml(String(p?.Advertisements?.[0]?.Content ?? ""));
  return {
    source: `hrmanager:${token}`,
    externalId: id,
    // The apply URL is the only per-position link the API gives; it resolves
    // to the ad itself, so it is both the human's door and our identity.
    url: String(p?.AdvertisementUrl ?? "").trim() ||
      `https://api.hr-manager.net/jobportal.svc/${token}/positionlist/`,
    title,
    company,
    location: city,
    remote: /\bremote\b|hjemmearbejde|fjernarbeid/i.test(`${city} ${title}`),
    description: body || title,
    postedAt: parseDotNetDate(p?.Published),
  };
}

export async function hrmanager(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(
    `https://api.hr-manager.net/jobportal.svc/${encodeURIComponent(token)}/positionlist/json/?incads=1&take=${MAX}`,
  );
  // The envelope names the tenant; prefer it over our guessed company string,
  // the way the name probe trusts CustomerName over the slug it guessed.
  const name = String(data?.CustomerName ?? "").trim() || company;
  const out: RawJob[] = [];
  for (const p of data?.Items ?? []) {
    const job = mapHrManagerJob(p, token, name);
    if (job) out.push(job);
  }
  return out;
}
