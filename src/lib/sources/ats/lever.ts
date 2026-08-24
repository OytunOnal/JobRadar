import { getJSON, type RawJob } from "../types";

// Lever does not ship one description — it ships an intro, an ARRAY of titled
// lists, and a closing block. We used to take `descriptionPlain` alone, which
// is the intro only, flattened. Verified against the live API: the `lists`
// entries are titled "Responsibilities" and "Requirements" and hold the
// bullets. So every Lever posting reached the fit judge as a paragraph of
// marketing prose with the actual job requirements discarded at ingest.
//
// The names Lever gives those blocks are better section labels than anything
// we could infer, so they travel to ingest as parts and are assembled there.
export function leverSections(j: any): Array<[string, unknown]> {
  const parts: Array<[string, unknown]> = [["", j.description]];
  for (const list of Array.isArray(j.lists) ? j.lists : []) {
    parts.push([String(list?.text ?? "").trim(), list?.content]);
  }
  parts.push(["", j.additional]);
  return parts;
}

export function mapLeverJob(j: any, token: string, company: string): RawJob {
  return {
    source: `lever:${token}`,
    externalId: String(j.id),
    url: j.hostedUrl,
    title: j.text ?? "",
    company,
    location: j.categories?.location ?? "",
    remote: /remote/i.test(j.categories?.location ?? "") || /remote/i.test(j.workplaceType ?? ""),
    workMode: j.workplaceType === "remote" ? "remote" as const
      : j.workplaceType === "hybrid" ? "hybrid" as const
      : j.workplaceType === "onsite" ? "onsite" as const : undefined,
    sections: leverSections(j),
    // The fallback when every named block is empty. Structure-destroyed, but
    // better than nothing.
    description: String(j.descriptionPlain ?? ""),
    postedAt: j.createdAt ? new Date(j.createdAt) : undefined,
  };
}

export async function lever(token: string, company: string, region = ""): Promise<RawJob[]> {
  // Lever's EU instance is a separate deployment with a SEPARATE slug
  // namespace — an EU board 404s on the US API. Pass region "eu" for boards
  // that live at jobs.eu.lever.co.
  const apiHost = region === "eu" ? "api.eu.lever.co" : "api.lever.co";
  const data = await getJSON(`https://${apiHost}/v0/postings/${token}?mode=json`);
  return (Array.isArray(data) ? data : []).map((j: any) => mapLeverJob(j, token, company));
}
