import { prisma } from "@/lib/db";
import { profile } from "@/lib/profile";
import {
  ageLabel,
  classifyFreshness,
  DELISTED_AFTER_DAYS,
  FRESH_MAX_DAYS,
} from "@/lib/freshness";
import { COUNTRY_NAMES, REGION_KEYS, REGIONS } from "@/lib/geo";
import { setStatus, triggerIngest, draftCover, analyzeFitAction } from "./actions";

export const dynamic = "force-dynamic";

// Track chips come from the user's configured tracks (config/user.ts override,
// generated profile, or the template defaults). Multi-select; "all" clears.
const TRACK_KEYS = profile.tracks.map((t) => t.key);
const VERDICTS = ["all", "strong", "possible", "weak"] as const;
// Multi-select work-mode filter; "all" clears. Values match Job.workMode.
const WORK_MODES = [
  { value: "remote", label: "remote" },
  { value: "hybrid", label: "hybrid" },
  { value: "onsite", label: "on-site" },
] as const;
const STATUSES = ["active", "all", "new", "interested", "applied", "interview", "offer", "rejected"] as const;
const AGES = ["fresh", "all"] as const;
const PAGE_SIZE = 30;

// Jobs the user is actively pursuing stay visible whatever their age.
const PURSUED = ["applied", "interview", "offer"];

function RadarMark() {
  return (
    <svg className="radar-mark" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="var(--line-strong)" strokeWidth="1" />
      <circle cx="12" cy="12" r="5.5" fill="none" stroke="var(--line-strong)" strokeWidth="1" />
      <line className="radar-sweep" x1="12" y1="12" x2="12" y2="2.5" stroke="var(--accent)" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="16" cy="8.5" r="1.6" fill="var(--strong)" />
    </svg>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ track?: string; status?: string; verdict?: string; loc?: string; q?: string; page?: string; age?: string; region?: string; country?: string; visa?: string }>;
}) {
  const sp = await searchParams;
  // track is a comma list of track keys; empty = all.
  const trackSet = new Set(
    (sp.track ?? "").split(",").map((s) => s.trim()).filter((s) => TRACK_KEYS.includes(s)),
  );
  const track = [...trackSet].sort().join(",");
  const status = sp.status ?? "active";
  const verdict = sp.verdict ?? "all";
  // loc is a comma list of work modes (e.g. "remote,hybrid"); empty = all.
  const locSet = new Set(
    (sp.loc ?? "").split(",").map((s) => s.trim()).filter((s) => WORK_MODES.some((m) => m.value === s)),
  );
  const loc = [...locSet].sort().join(",");
  const age = sp.age ?? "fresh";
  // region: comma list of region keys; country: comma list of alpha-2 codes
  // plus the special buckets "other" | "remote" | "unknown".
  const regionSet = new Set(
    (sp.region ?? "").split(",").map((s) => s.trim()).filter((s) => REGION_KEYS.includes(s)),
  );
  const region = [...regionSet].sort().join(",");
  const countryParam = new Set((sp.country ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const visaSet = new Set(
    (sp.visa ?? "").split(",").map((s) => s.trim()).filter((s) => ["yes", "unknown", "no"].includes(s)),
  );
  const visa = [...visaSet].sort().join(",");
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  // Semantic duplicates (reposts of a tracked role) never render.
  const where: any = { duplicateOfId: null };
  const and: any[] = [];
  if (trackSet.size > 0) where.track = { in: [...trackSet] };
  if (status === "active") where.status = { in: ["new", "interested", "applied", "interview"] };
  else if (status !== "all") where.status = status;
  if (verdict !== "all") where.fitVerdict = verdict;
  if (locSet.size > 0) where.workMode = { in: [...locSet] };
  if (q) and.push({ OR: [{ title: { contains: q } }, { company: { contains: q } }] });
  if (visaSet.size > 0) where.visa = { in: [...visaSet] };

  // The pool's own clock: how far the newest observation has advanced. Guards
  // the delisted check against "we simply haven't ingested lately".
  const poolNewest = (await prisma.job.aggregate({ _max: { lastSeenAt: true } }))._max.lastSeenAt;

  if (age === "fresh") {
    const now = Date.now();
    const freshCutoff = new Date(now - FRESH_MAX_DAYS * 86_400_000);
    const clauses: any[] = [
      { delistedAt: null }, // swept-away roles are gone from the default view
      // Anchor (postedAt, else firstSeenAt) within the fresh window...
      {
        OR: [
          { postedAt: { gte: freshCutoff } },
          { postedAt: null, firstSeenAt: { gte: freshCutoff } },
        ],
      },
    ];
    // ...and, for direct-source jobs, still listed at the source.
    if (poolNewest) {
      const delistCutoff = new Date(poolNewest.getTime() - DELISTED_AFTER_DAYS * 86_400_000);
      clauses.push({
        NOT: { AND: [{ source: { contains: ":" } }, { lastSeenAt: { lt: delistCutoff } }] },
      });
    }
    // Jobs being pursued are never hidden by age.
    and.push({ OR: [{ AND: clauses }, { status: { in: PURSUED } }] });
  }
  // ── Region / country facet ─────────────────────────────────────────────
  // Country chips cascade from the region selection: top 10 by count within
  // the allowed set + "other" (the long tail) + "remote" (no location) +
  // "unknown" (location we couldn't place). Counts are computed with every
  // filter EXCEPT the country selection, so chips don't jump while picking.
  const allowedCountries = regionSet.size > 0
    ? [...new Set([...regionSet].flatMap((r) => [...REGIONS[r]]))]
    : Object.keys(COUNTRY_NAMES);

  const facetWhere: any = { ...where, AND: [...and] };
  if (regionSet.size > 0) facetWhere.AND.push({ country: { in: allowedCountries } });
  const [countryCounts, remoteCount, unknownCount] = await Promise.all([
    prisma.job.groupBy({ by: ["country"], _count: true, where: { ...facetWhere, country: { in: allowedCountries } } }),
    prisma.job.count({ where: { ...where, AND: [...and, { country: null, workMode: "remote" }] } }),
    prisma.job.count({ where: { ...where, AND: [...and, { country: null, workMode: { not: "remote" } }] } }),
  ]);
  const counts = new Map(countryCounts.map((c) => [c.country as string, c._count]));
  const topCountries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c]) => c);
  const otherCountries = allowedCountries.filter((c) => !topCountries.includes(c));
  const otherCount = otherCountries.reduce((sum, c) => sum + (counts.get(c) ?? 0), 0);

  const countrySet = new Set(
    [...countryParam].filter((c) => topCountries.includes(c) || ["other", "remote", "unknown"].includes(c)),
  );
  const country = [...countrySet].sort().join(",");

  if (countrySet.size > 0) {
    const or: any[] = [];
    const codes = [...countrySet].filter((c) => !["other", "remote", "unknown"].includes(c));
    if (codes.length) or.push({ country: { in: codes } });
    if (countrySet.has("other")) or.push({ country: { in: otherCountries } });
    if (countrySet.has("remote")) or.push({ country: null, workMode: "remote" });
    if (countrySet.has("unknown")) or.push({ country: null, workMode: { not: "remote" } });
    and.push({ OR: or });
  } else if (regionSet.size > 0) {
    and.push({ country: { in: allowedCountries } });
  }

  if (and.length) where.AND = and;

  const [jobs, filteredCount, statusCounts, verdictCounts] = await Promise.all([
    prisma.job.findMany({
      where,
      // LLM-analyzed jobs (real fit) rank first; the rest fall back to keyword score.
      orderBy: [
        { fitScore: { sort: "desc", nulls: "last" } },
        { sourceTrust: "desc" }, // equal fit: the direct-apply ATS listing outranks the aggregator copy
        { score: "desc" },
        { createdAt: "desc" },
      ],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.job.count({ where }),
    prisma.job.groupBy({ by: ["status"], _count: true }),
    prisma.job.groupBy({ by: ["fitVerdict"], _count: true }),
  ]);

  const sc = Object.fromEntries(statusCounts.map((c) => [c.status, c._count]));
  const vc = Object.fromEntries(verdictCounts.map((c) => [c.fitVerdict ?? "unscored", c._count]));
  const total = statusCounts.reduce((a, c) => a + c._count, 0);
  const lastPage = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));

  // Build hrefs that preserve every other filter (page resets on filter change).
  const href = (over: Partial<Record<"track" | "status" | "verdict" | "loc" | "q" | "page" | "age" | "region" | "country" | "visa", string>>) => {
    const p = new URLSearchParams();
    const merged = { track, status, verdict, loc, q, age, region, country, visa, page: "", ...over };
    if (merged.track) p.set("track", merged.track);
    if (merged.status !== "active") p.set("status", merged.status);
    if (merged.verdict !== "all") p.set("verdict", merged.verdict);
    if (merged.loc) p.set("loc", merged.loc);
    if (merged.age !== "fresh") p.set("age", merged.age);
    if (merged.region) p.set("region", merged.region);
    if (merged.country) p.set("country", merged.country);
    if (merged.visa) p.set("visa", merged.visa);
    if (merged.q) p.set("q", merged.q);
    if (merged.page && merged.page !== "1") p.set("page", merged.page);
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <RadarMark />
          <div>
            <h1>JOBRADAR</h1>
            <div className="sub">{profile.name} — job discovery &amp; application tracker</div>
          </div>
        </div>
        <form className="search" action="/" method="get">
          {track && <input type="hidden" name="track" value={track} />}
          {status !== "active" && <input type="hidden" name="status" value={status} />}
          {verdict !== "all" && <input type="hidden" name="verdict" value={verdict} />}
          {loc && <input type="hidden" name="loc" value={loc} />}
          <input name="q" defaultValue={q} placeholder="Search title or company" aria-label="Search jobs" />
        </form>
        <form action={triggerIngest}>
          <button className="btn primary" type="submit">Scan for new jobs</button>
        </form>
      </header>

      <div className="statstrip">
        <span><b>{total}</b> tracked</span>
        <span className="s-strong"><b>{vc["strong"] ?? 0}</b> strong</span>
        <span className="s-possible"><b>{vc["possible"] ?? 0}</b> possible</span>
        <span><b>{sc["applied"] ?? 0}</b> applied</span>
        <span><b>{sc["interview"] ?? 0}</b> interview</span>
      </div>

      <div className="filterbar">
        <div className="fgroup">
          <span className="flabel">track</span>
          <a href={href({ track: "" })} className={`chip ${trackSet.size === 0 ? "active" : ""}`}>all</a>
          {TRACK_KEYS.map((t) => {
            const next = new Set(trackSet);
            if (next.has(t)) next.delete(t); else next.add(t);
            return (
              <a key={t} href={href({ track: [...next].sort().join(",") })}
                 className={`chip ${trackSet.has(t) ? "active" : ""}`}>{t}</a>
            );
          })}
        </div>
        <div className="fgroup">
          <span className="flabel">fit</span>
          {VERDICTS.map((v) => (
            <a key={v} href={href({ verdict: v })} className={`chip ${verdict === v ? "active" : ""}`}>{v}</a>
          ))}
        </div>
        <div className="fgroup">
          <span className="flabel">where</span>
          <a href={href({ loc: "" })} className={`chip ${locSet.size === 0 ? "active" : ""}`}>all</a>
          {WORK_MODES.map((m) => {
            const next = new Set(locSet);
            if (next.has(m.value)) next.delete(m.value); else next.add(m.value);
            return (
              <a key={m.value} href={href({ loc: [...next].sort().join(",") })}
                 className={`chip ${locSet.has(m.value) ? "active" : ""}`}>{m.label}</a>
            );
          })}
        </div>
        <div className="fgroup">
          <span className="flabel">region</span>
          <a href={href({ region: "", country: "" })} className={`chip ${regionSet.size === 0 ? "active" : ""}`}>all</a>
          {REGION_KEYS.map((r) => {
            const next = new Set(regionSet);
            if (next.has(r)) next.delete(r); else next.add(r);
            // Region change invalidates the country picks (chip list changes).
            return (
              <a key={r} href={href({ region: [...next].sort().join(","), country: "" })}
                 className={`chip ${regionSet.has(r) ? "active" : ""}`}>{r}</a>
            );
          })}
        </div>
        <div className="fgroup">
          <span className="flabel">country</span>
          <a href={href({ country: "" })} className={`chip ${countrySet.size === 0 ? "active" : ""}`}>all</a>
          {topCountries.map((c) => {
            const next = new Set(countrySet);
            if (next.has(c)) next.delete(c); else next.add(c);
            return (
              <a key={c} href={href({ country: [...next].sort().join(",") })}
                 className={`chip ${countrySet.has(c) ? "active" : ""}`}>{COUNTRY_NAMES[c] ?? c} {counts.get(c)}</a>
            );
          })}
          {([["other", otherCount], ["remote", remoteCount], ["unknown", unknownCount]] as const).map(([b, n]) => {
            if (n === 0 && !countrySet.has(b)) return null;
            const next = new Set(countrySet);
            if (next.has(b)) next.delete(b); else next.add(b);
            return (
              <a key={b} href={href({ country: [...next].sort().join(",") })}
                 className={`chip ${countrySet.has(b) ? "active" : ""}`}>{b} {n}</a>
            );
          })}
        </div>
        <div className="fgroup">
          <span className="flabel">visa</span>
          <a href={href({ visa: "" })} className={`chip ${visaSet.size === 0 ? "active" : ""}`}>all</a>
          {(["yes", "unknown", "no"] as const).map((v) => {
            const next = new Set(visaSet);
            if (next.has(v)) next.delete(v); else next.add(v);
            return (
              <a key={v} href={href({ visa: [...next].sort().join(",") })}
                 className={`chip ${visaSet.has(v) ? "active" : ""}`}>{v === "yes" ? "sponsors" : v}</a>
            );
          })}
        </div>
        <div className="fgroup">
          <span className="flabel">status</span>
          {STATUSES.map((s) => (
            <a key={s} href={href({ status: s })} className={`chip ${status === s ? "active" : ""}`}>{s}</a>
          ))}
        </div>
        <div className="fgroup">
          <span className="flabel">age</span>
          {AGES.map((a) => (
            <a key={a} href={href({ age: a })} className={`chip ${age === a ? "active" : ""}`}>{a}</a>
          ))}
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="empty">
          No jobs match these filters.
          <div className="hint">Clear a filter, or run a scan to pull fresh listings.</div>
        </div>
      ) : (
        jobs.map((j) => {
          const freshness = classifyFreshness(j, new Date(), poolNewest ?? undefined);
          return (
          <article className="job" key={j.id}>
            <div className="fitcell">
              {j.fitScore != null ? (
                <>
                  <div className={`fitnum v-${j.fitVerdict}`}>{j.fitScore}</div>
                  <div className="gauge"><span className={`v-${j.fitVerdict}`} style={{ width: `${j.fitScore}%` }} /></div>
                  <div className={`vlabel v-${j.fitVerdict}`}>{j.fitVerdict}</div>
                </>
              ) : (
                <>
                  <div className="fitnum unscored">{j.score}</div>
                  <div className="vlabel unscored">keyword</div>
                </>
              )}
            </div>

            <div className="jobmain">
              <p className="title">
                <a href={j.url} target="_blank" rel="noopener noreferrer">{j.title}</a>
              </p>
              <div className="meta">
                {j.track && <span className="badge">{j.track}</span>}
                {j.workMode !== "onsite" && <span className="badge">{j.workMode}</span>}
                {(freshness === "evergreen" || freshness === "delisted") && (
                  <span className={`badge age-${freshness}`}>{freshness}</span>
                )}
                {j.ghostRisk && <span className="badge ghost">ghost?</span>}
                {j.visa === "yes" && <span className="badge s-strong">visa</span>}
                {j.fitCategory && j.fitCategory !== "NONE" && j.fitCategory !== "OTHER" && (
                  <span className="badge">{j.fitCategory.toLowerCase().replace("_", " ")}</span>
                )}
                {j.company}
                {j.location ? ` · ${j.location}` : ""}
                {j.salaryText ? ` · ${j.salaryText}` : ""}
                {" · "}
                <span className="src">{j.source}</span>
                {" · "}
                <span className="src" title={j.postedAt ? "posted" : "first seen"}>
                  {ageLabel(j.postedAt ?? j.firstSeenAt)}
                </span>
              </div>
              {j.fitComment && <div className="fitcomment">{j.fitComment}</div>}
              {j.scoreReason && <div className="reason">{j.scoreReason}</div>}
              {j.coverLetter && (
                <details className="cover">
                  <summary>cover letter draft</summary>
                  <pre>{j.coverLetter}</pre>
                </details>
              )}
            </div>

            <div className="actions">
              <div className="status-pill">{j.status}</div>
              {j.status !== "applied" && (
                <form action={setStatus}>
                  <input type="hidden" name="id" value={j.id} />
                  <input type="hidden" name="status" value="applied" />
                  <button className="btn act" type="submit">Mark applied</button>
                </form>
              )}
              {j.status !== "interested" && (
                <form action={setStatus}>
                  <input type="hidden" name="id" value={j.id} />
                  <input type="hidden" name="status" value="interested" />
                  <button className="btn" type="submit">Interested</button>
                </form>
              )}
              <form action={analyzeFitAction}>
                <input type="hidden" name="id" value={j.id} />
                <button className="btn" type="submit">Analyze fit</button>
              </form>
              <form action={draftCover}>
                <input type="hidden" name="id" value={j.id} />
                <button className="btn" type="submit">Draft letter</button>
              </form>
              <form action={setStatus}>
                <input type="hidden" name="id" value={j.id} />
                <input type="hidden" name="status" value="ignored" />
                <button className="btn quiet" type="submit">Dismiss</button>
              </form>
            </div>
          </article>
          );
        })
      )}

      {lastPage > 1 && (
        <nav className="pager" aria-label="Pagination">
          {page > 1 && <a href={href({ page: String(page - 1) })}>← Prev</a>}
          <span>page {page} / {lastPage} · {filteredCount} jobs</span>
          {page < lastPage && <a href={href({ page: String(page + 1) })}>Next →</a>}
        </nav>
      )}
    </div>
  );
}
