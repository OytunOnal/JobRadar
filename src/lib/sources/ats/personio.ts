import { getText, stripHtml, type RawJob } from "../types";

// Personio ships an XML feed of <position> blocks, each carrying
// <jobDescription> PAIRS: a <name> that is the section heading ("Deine
// Skills", "Deine Benefits") and a <value> holding its HTML. We used to take
// the values, join them with a SPACE and discard every heading — turning a
// structured posting into one flat line.
//
// The whole parse is pure over the feed text, which is why it is worth having
// out here: the <name>/<value> pairing is the most intricate logic in the ATS
// layer, and until now no test could reach it without a network call.
export function parsePersonioFeed(xml: string, token: string, company: string): RawJob[] {
  const jobs: RawJob[] = [];
  for (const [, block] of xml.matchAll(/<position>([\s\S]*?)<\/position>/g)) {
    // Position-level tags precede the <jobDescriptions> block in the feed,
    // so a first-match read of <name> is the job title, not a section header.
    const tag = (name: string) => {
      const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
      return m ? m[1].trim() : "";
    };
    const id = tag("id");
    if (!id) continue;
    const office = stripHtml(tag("office"));
    const sections: Array<[string, unknown]> = [];
    for (const [, entry] of block.matchAll(/<jobDescription>([\s\S]*?)<\/jobDescription>/g)) {
      const heading = entry.match(/<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/)?.[1]?.trim() ?? "";
      const value = entry.match(/<value>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/value>/)?.[1] ?? "";
      if (value.trim()) sections.push([heading, value]);
    }
    // Older feeds carry bare <value> blocks with no pairing — fall back to
    // those rather than returning an empty body. The paired case travels as
    // sections and is assembled at ingest.
    const description = stripHtml(
      [...block.matchAll(/<value>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/value>/g)]
        .map((m) => m[1]).join("\n\n"),
    );
    const title = stripHtml(tag("name"));
    jobs.push({
      source: `personio:${token}`,
      externalId: id,
      url: `https://${token}.jobs.personio.com/job/${id}`,
      title,
      company: stripHtml(tag("subcompany")) || company,
      location: office,
      remote: /remote|home\s*office/i.test(`${office} ${tag("schedule")} ${title}`),
      sections,
      description: description || title,
      postedAt: tag("createdAt") ? new Date(tag("createdAt")) : undefined,
    });
  }
  return jobs;
}

export async function personio(token: string, company: string): Promise<RawJob[]> {
  // XML feed on the company's subdomain. The .de/.com namespaces are mirrored
  // (verified live: the same slug answers on both) — .com is used as canonical.
  // Unknown subdomains 307-redirect to marketing, hence redirect: "manual".
  const xml = await getText(`https://${token}.jobs.personio.com/xml`, {
    redirect: "manual",
  });
  return parsePersonioFeed(xml, token, company);
}
