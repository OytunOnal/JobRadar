import { getText, stripHtml, type RawJob, type Source } from "./types";

// greenjobs.de — German renewable/sustainability job board (from the
// awesome-sustainability-jobs review). Public Atom feed, keyless, ~150 newest
// postings. Title convention: "Role (Location[, extra]) - Company".

export function mapGreenjobsEntry(chunk: string): RawJob | null {
  const pick = (tag: string) =>
    chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"))?.[1]?.trim() ?? "";
  const rawTitle = stripHtml(pick("title")).replace(/&amp;/g, "&");
  const link = chunk.match(/<link[^>]+href="([^"]+)"/i)?.[1]?.replace(/&amp;/g, "&") ?? "";
  const updated = pick("updated");
  if (!rawTitle || !link) return null;
  // "CAD-Konstrukteur (m/w/d) (Meißen / bundesweit) - UKA Umweltgerechte ..."
  // The LAST " - " separates the company; the LAST parenthetical before it is
  // usually the location — but "(m/w/d)" gender markers also use parens, so
  // only treat it as location when it isn't a gender marker.
  const dash = rawTitle.lastIndexOf(" - ");
  const company = dash === -1 ? "" : rawTitle.slice(dash + 3).trim();
  let title = dash === -1 ? rawTitle : rawTitle.slice(0, dash).trim();
  let location = "";
  const paren = title.match(/\(([^()]+)\)\s*$/);
  if (paren && !/^[mwfdx/\s]+$/i.test(paren[1])) {
    location = paren[1].trim();
    title = title.slice(0, paren.index).trim();
  }
  const id = link.match(/id=(\d+)/)?.[1] ?? link;
  return {
    source: "greenjobsde",
    externalId: String(id),
    url: link,
    title,
    company: company || "greenjobs.de",
    location,
    remote: /remote|home\s*office|bundesweit/i.test(rawTitle),
    description: rawTitle,
    postedAt: updated ? new Date(updated) : undefined,
  };
}

export async function fetchGreenjobsDe(): Promise<RawJob[]> {
  const xml = await getText("https://www.greenjobs.de/angebote/neueste.html?&feed=atom");
  return xml
    .split(/<entry>/i)
    .slice(1)
    .map(mapGreenjobsEntry)
    .filter((j): j is RawJob => j !== null);
}

export const greenjobsde: Source = { name: "greenjobsde", fetch: fetchGreenjobsDe };
