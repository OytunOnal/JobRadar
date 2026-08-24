import { getJSON, getText, type RawJob } from "../types";

// Comeet. Token = "<company>/<uid>" from www.comeet.com/jobs/<company>/<uid>.
// The hosted page embeds the per-tenant API token; bootstrap it, then hit the
// documented careers API.

// The bootstrap, split out because it is the fragile half: a page-shape change
// breaks the whole connector and this is the line that would notice.
export function extractComeetToken(html: string): string | null {
  return html.match(/"token"\s*:\s*"([A-F0-9]+)"/i)?.[1] ?? null;
}

export function mapComeetPosition(j: any, token: string, company: string): RawJob | null {
  if (!j?.uid || !j?.name) return null;
  const loc = j.location ?? {};
  const locStr = loc.name ?? [loc.city, loc.country].filter(Boolean).join(", ");
  return {
    source: `comeet:${token}`,
    externalId: String(j.uid),
    url: String(j.url_comeet_hosted_page ?? j.url_active_page ?? ""),
    title: String(j.name).trim(),
    company,
    location: locStr,
    remote: Boolean(loc.is_remote) || /remote/i.test(String(j.workplace_type ?? "")),
    sections: [
      ["", j.details?.description],
      ["Requirements", j.details?.requirements],
    ],
    description: String(j.name),
    postedAt: j.time_updated ? new Date(j.time_updated) : undefined,
  };
}

export async function comeet(token: string, company: string): Promise<RawJob[]> {
  const [slug, uid] = token.split("/");
  if (!slug || !uid) return [];
  const html = await getText(`https://www.comeet.com/jobs/${slug}/${uid}`);
  const tok = extractComeetToken(html);
  if (!tok) throw new Error(`comeet:${token} -> no embedded API token`);
  const rows = await getJSON(
    `https://www.comeet.co/careers-api/2.0/company/${encodeURIComponent(uid)}/positions?token=${tok}&details=true`,
  );
  return (Array.isArray(rows) ? rows : [])
    .map((j: any) => mapComeetPosition(j, token, company))
    .filter((j): j is RawJob => j !== null);
}
