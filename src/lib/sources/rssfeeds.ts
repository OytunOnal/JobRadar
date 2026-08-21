import { getText, stripHtml, type RawJob, type Source } from "./types";

// Generic RSS/Atom job-feed connector. One parser, a table of feeds — adding
// a board is data, not code. Curated from the awesome-job-boards (CC0) and
// remote-working-list (MIT) sweeps, 2026-08-21, every URL live-verified;
// known feed traps (blog/news/event feeds, white-label redirects) excluded.
//
// Company extraction is heuristic ("Role at Company", "Role - Company",
// <author>/<dc:creator>); when nothing matches, the feed's label stands in —
// scoring only needs title text, and the dedup funnel handles the rest.

interface FeedDef {
  id: string; // source id, also used in Job.source
  label: string; // company fallback
  url: string;
  remoteDefault?: boolean; // board is remote-only — mark jobs remote
  company?: "at" | "dash" | "author"; // preferred extraction, tried first
}

export const FEEDS: FeedDef[] = [
  // ── Visa / country gap fillers ────────────────────────────────────────────
  { id: "huntukvisa", label: "Hunt UK Visa Sponsors", url: "https://huntukvisasponsors.com/jobs/feed.xml", company: "at" },
  { id: "solidjobs", label: "SOLID.Jobs", url: "https://solid.jobs/rss/job-offers", company: "dash" },
  { id: "impjieg", label: "Impjieg", url: "https://impjieg.work/api/jobs/rss", company: "at" },
  { id: "ziprecruiterie", label: "ZipRecruiter IE", url: "https://www.ziprecruiter.ie/jobs.rss", company: "at" },
  { id: "definitejobs", label: "DefiniteJobs UK", url: "https://definitejobs.co.uk/feed/", company: "at" },
  // ── AI / your tracks ──────────────────────────────────────────────────────
  { id: "agenticjobs2", label: "Agentic Engineering Jobs", url: "https://agentic-engineering-jobs.com/rss", company: "at" },
  { id: "pyjobs", label: "pyJobs", url: "https://www.pyjobs.com/rss", company: "at" },
  { id: "qajobsco", label: "QA Jobs", url: "https://www.qajobs.co/rss", company: "at" },
  { id: "typescriptjobs", label: "TypeScriptJobs", url: "https://typescriptjobs.net/feed.xml", company: "at" },
  { id: "devtooljobs", label: "devtooljobs", url: "https://devtooljobs.com/rss.xml", company: "at" },
  { id: "pycoders", label: "Pycoder's Jobs", url: "https://www.pythonjobshq.com/jobs.rss", company: "at" },
  { id: "pythonorg", label: "Python.org Jobs", url: "https://www.python.org/jobs/feed/rss/", company: "dash" },
  { id: "remotepython", label: "Remote Python", url: "https://www.remotepython.com/latest/jobs/feed/", remoteDefault: true, company: "at" },
  { id: "findadatajob", label: "FindADataJob", url: "https://findadatajob.com/rss", company: "at" },
  { id: "odscjobs", label: "ODSC Jobs", url: "https://jobs.opendatascience.com/feed/", company: "at" },
  { id: "jobsbyculture", label: "JobsByCulture", url: "https://jobsbyculture.com/feed.xml", company: "at" },
  { id: "jobyap", label: "JobYap", url: "https://jobyap.com/feed.xml", company: "at" },
  // ── FOSS / EU-leaning dev ─────────────────────────────────────────────────
  { id: "fossjobs", label: "fossjobs", url: "https://www.fossjobs.net/rss/all/", company: "dash" },
  { id: "fossfox", label: "Fossfox", url: "https://fossfox.com/feed/", company: "at" },
  { id: "rejobs", label: "Rejobs", url: "https://rejobs.org/en/rss/renewable-energy-jobs", company: "at" },
  { id: "fourdayweek", label: "4dayweek", url: "https://4dayweek.io/feed", company: "at" },
  { id: "mozillajobs", label: "Mozilla", url: "https://www.mozilla.org/en-US/careers/feed/" },
  // ── Language / framework niches ───────────────────────────────────────────
  { id: "golangprojects", label: "Golangprojects", url: "https://www.golangprojects.com/rss.xml", company: "dash" },
  { id: "elixirjobs", label: "Elixir Jobs", url: "https://elixirjobs.net/rss", company: "at" },
  { id: "larajobs", label: "LaraJobs", url: "https://larajobs.com/feed", company: "at" },
  { id: "wpjobs", label: "WordPress Jobs", url: "https://jobs.wordpress.net/feed/", company: "dash" },
  { id: "clojurejobs", label: "ClojureJobboard", url: "https://clojurejobboard.com/rss.xml", company: "at" },
  { id: "rusers", label: "R-users", url: "https://feeds.feedburner.com/RJobs", company: "at" },
  { id: "jobbsy", label: "Jobbsy", url: "https://jobbsy.dev/rss.xml", company: "at" },
  { id: "softwaretechjobs", label: "Software Tech Jobs", url: "https://softwaretechjobs.com/rss.xml", company: "at" },
  // ── Remote generalists ────────────────────────────────────────────────────
  { id: "nodesk", label: "NODESK", url: "https://nodesk.co/remote-jobs/index.xml", remoteDefault: true, company: "at" },
  { id: "iloveremote", label: "iloveremote", url: "https://iloveremote.io/rss/jobs/city/remote.rss", remoteDefault: true, company: "at" },
  { id: "remote1st", label: "Remote1stJobs", url: "https://www.remote1stjobs.com/rss.xml", remoteDefault: true, company: "at" },
  { id: "jobspresso", label: "Jobspresso", url: "https://jobspresso.co/feed/?post_type=job_listing", remoteDefault: true, company: "at" },
  { id: "virtualvocations", label: "Virtual Vocations", url: "https://www.virtualvocations.com/rss", remoteDefault: true, company: "at" },
  { id: "dynamitejobs", label: "DynamiteJobs", url: "https://dynamitejobs.com/feed/rss.xml", remoteDefault: true, company: "at" },
  { id: "trulyremote", label: "TrulyRemote", url: "https://trulyremote.co/rss.xml", remoteDefault: true, company: "at" },
  { id: "realwfa", label: "RealWorkFromAnywhere", url: "https://www.realworkfromanywhere.com/rss.xml", remoteDefault: true, company: "at" },
  { id: "letswork", label: "letsworkremotely", url: "https://www.letsworkremotely.com/feed/", remoteDefault: true, company: "at" },
  { id: "remoteyeah", label: "RemoteYeah", url: "https://remoteyeah.com/rss.xml", remoteDefault: true, company: "at" },
  { id: "workew", label: "Workew", url: "https://workew.com/feed/", remoteDefault: true, company: "at" },
  { id: "benture", label: "Benture", url: "https://benture.io/rss", remoteDefault: true, company: "at" },
  { id: "hasjob", label: "HasJob", url: "https://hasjob.co/feed", company: "at" },
  { id: "redditremotejobs", label: "r/RemoteJobs", url: "https://www.reddit.com/r/RemoteJobs/.rss", remoteDefault: true },
  { id: "redditremotejs", label: "r/remotejs", url: "https://www.reddit.com/r/remotejs/.rss", remoteDefault: true },
  { id: "redditremotepy", label: "r/remotepython", url: "https://www.reddit.com/r/remotepython/.rss", remoteDefault: true },
  // ── Crypto ────────────────────────────────────────────────────────────────
  { id: "cryptojobslist", label: "CryptoJobsList", url: "https://api.cryptojobslist.com/jobs.rss?jobLocation=Remote", remoteDefault: true, company: "at" },
  { id: "cryptojobs", label: "CryptoJobs", url: "https://crypto.jobs/feed/rss", company: "at" },
  { id: "chainjobs", label: "ChainJobs", url: "https://chainjobs.io/feed.xml", company: "at" },
  { id: "jobsinblockchain", label: "JobsInBlockchain", url: "https://jobsinblockchain.com/rss", company: "at" },
  { id: "remote3", label: "Remote3", url: "https://www.remote3.co/api/rss", remoteDefault: true, company: "at" },
  { id: "blockchainjb", label: "Blockchain Jobs Board", url: "https://www.blockchainjobsboard.com/feed/", company: "at" },
  { id: "predictionjobs", label: "PredictionJobs", url: "https://predictionjobs.co/feed.xml", company: "at" },
  // ── Design / misc breadth ─────────────────────────────────────────────────
  { id: "dribbble", label: "Dribbble", url: "https://dribbble.com/jobs.rss?anywhere=true", company: "at" },
  { id: "coroflot", label: "Coroflot", url: "https://feeds.feedburner.com/coroflot/AllJobs", company: "at" },
  { id: "smashingjobs", label: "Smashing Jobs", url: "https://www.smashingmagazine.com/jobs/feed/", company: "at" },
  { id: "designjb", label: "Design Jobs Board", url: "https://www.designjobsboard.com/feed", company: "at" },
  { id: "osdesign", label: "Open Source Design", url: "https://opensourcedesign.net/feed", company: "at" },
  { id: "cybersecjobs", label: "CyberSecurityJobs", url: "https://www.cybersecurityjobs.com/feed", company: "at" },
  { id: "ntenjobs", label: "NTEN", url: "https://www.nten.org/feed/?post_type=job", company: "at" },
  { id: "skolljobs", label: "Skoll", url: "https://skoll.org/?feed=job_feed", company: "at" },
  { id: "itjobpro", label: "IT Job Pro", url: "https://itjobpro.com/feed/", company: "at" },
  { id: "jobfound", label: "JobFound", url: "https://jobfound.org/feed.xml", company: "at" },
  { id: "hiddenjobs", label: "Hidden Jobs", url: "https://hidden-jobs.com/feed/", company: "at" },
  { id: "entryleveljobs", label: "Entry Level Jobs", url: "https://entryleveljobs.me/rss.xml", company: "at" },
  { id: "bestpmjobs", label: "Best PM Jobs", url: "https://www.bestpmjobs.com/jobs.rss", company: "at" },
];

function pickTag(chunk: string, tags: string[]): string {
  for (const tag of tags) {
    const m = chunk.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, "i"));
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return "";
}

function pickLink(chunk: string): string {
  // Atom: <link href="..."/>; RSS: <link>text</link> — RSS form wins when both parse
  const atom = chunk.match(/<link[^>]*href="([^"]+)"[^>]*\/?>(?!\s*<\/link>)/i);
  const rss = chunk.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
  const raw = (rss?.[1]?.trim() || atom?.[1] || "").replace(/&amp;/g, "&");
  return raw.startsWith("http") ? raw : "";
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

export function splitCompany(rawTitle: string, def: FeedDef): { title: string; company: string } {
  const t = rawTitle.trim();
  const strategies: Array<() => { title: string; company: string } | null> = [
    () => {
      const m = t.match(/^(.{3,}?)\s+at\s+(.{2,60})$/i);
      return m ? { title: m[1].trim(), company: m[2].trim() } : null;
    },
    () => {
      const i = t.lastIndexOf(" - ");
      if (i < 3) return null;
      const company = t.slice(i + 3).trim();
      // A "company" that reads like job words is probably still the title.
      if (company.length > 60 || /\b(remote|engineer|developer|manager|senior|junior)\b/i.test(company)) return null;
      return { title: t.slice(0, i).trim(), company };
    },
  ];
  const order = def.company === "dash" ? [strategies[1], strategies[0]] : strategies;
  for (const s of order) {
    const r = s();
    if (r) return r;
  }
  return { title: t, company: "" };
}

export function parseFeed(xml: string, def: FeedDef): RawJob[] {
  const chunks = xml.includes("<entry") ? xml.split(/<entry[\s>]/i).slice(1) : xml.split(/<item[\s>]/i).slice(1);
  const out: RawJob[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const rawTitle = decode(stripHtml(pickTag(chunk, ["title"])));
    const link = pickLink(chunk);
    if (!rawTitle || !link) continue;
    const dateStr = pickTag(chunk, ["pubDate", "published", "updated", "dc:date"]);
    const author = decode(stripHtml(pickTag(chunk, ["dc:creator", "author", "name"])));
    let { title, company } = splitCompany(rawTitle, def);
    if (!company && def.company === "author" && author) company = author;
    if (!company) company = author || def.label;
    const body = decode(stripHtml(pickTag(chunk, ["description", "summary", "content", "content:encoded"]))).slice(0, 4000);
    const id = link.replace(/^https?:\/\//, "").slice(0, 240);
    if (seen.has(id)) continue;
    seen.add(id);
    const posted = dateStr ? new Date(dateStr) : undefined;
    out.push({
      source: def.id,
      externalId: id,
      url: link,
      title,
      company,
      location: "",
      remote: Boolean(def.remoteDefault) || /remote/i.test(rawTitle),
      description: body || rawTitle,
      postedAt: posted && !Number.isNaN(posted.getTime()) ? posted : undefined,
    });
  }
  return out;
}

// One Source per feed so a dead board neither sinks the batch nor hides —
// ingest's per-source error handling reports it by name.
export const rssSources: Source[] = FEEDS.map((def) => ({
  name: def.id,
  async fetch(): Promise<RawJob[]> {
    const xml = await getText(def.url);
    return parseFeed(xml, def);
  },
}));
