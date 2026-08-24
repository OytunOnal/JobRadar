import { prisma } from "@/lib/db";
import { profile } from "@/lib/profile";
import { ageLabel } from "@/lib/freshness";
import { COUNTRY_NAMES, REGION_KEYS } from "@/lib/geo";
import { setStatus, triggerIngest, draftCover, analyzeFitAction, dismissCompanyRest } from "./actions";
import { DISMISS_REASONS } from "@/lib/dismiss-reasons";
import { liveWhere, pursuedWhere, PURSUED_STATUSES } from "@/lib/pool";
import { isVerdictStale, postingLabels, staleVerdictTitle, type Label } from "@/lib/labels";
import {
  allowedCountries, countryChips, radarFacetWhere, radarFilters, radarPaging,
  radarWhere, PAGE_SIZE, RADAR_ORDER, VERDICTS, VISA_TIERS, VISA_TIER_LABELS, WORK_MODES,
} from "@/lib/radar";

export const dynamic = "force-dynamic";

// Track chips come from the user's configured tracks (config/user.ts override,
// generated profile, or the template defaults). Multi-select; "all" clears.
const TRACK_KEYS = profile.tracks.map((t) => t.key);
// The shortlist is a glance, not a list: bound it so it can never become one.
const STARRED_MAX = 40;


// Labels carry MEANING (`tone`), not placement. The page decides what a risk
// looks like and where it goes; the rule module decides what is one.
function Badges({ labels }: { labels: Label[] }) {
  return (
    <>
      {labels.map((l) => (
        <span key={l.kind + l.text} className={`badge t-${l.tone}`} title={l.title}>
          {l.text}
        </span>
      ))}
    </>
  );
}

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
  searchParams: Promise<{ track?: string; verdict?: string; loc?: string; q?: string; page?: string; region?: string; country?: string; visa?: string }>;
}) {
  const f = radarFilters(await searchParams, TRACK_KEYS);
  const trackSet = new Set(f.tracks);
  const locSet = new Set(f.workModes);
  const regionSet = new Set(f.regions);
  const visaSet = new Set(f.visaTiers);
  const { verdict, q, page } = f;
  const track = [...trackSet].sort().join(",");
  const loc = [...locSet].sort().join(",");
  const region = [...regionSet].sort().join(",");
  const visa = [...visaSet].sort().join(",");

  // The pool's own clock: how far the newest observation has advanced. Guards
  // the delisted check against "we simply haven't ingested lately".
  const poolNewest = (await prisma.job.aggregate({ _max: { lastSeenAt: true } }))._max.lastSeenAt;

  // Country chips cascade from the region selection: top 10 by count within the
  // allowed set + "other" (the long tail) + "remote" (no location) + "unknown"
  // (a location we could not place). Counted against every filter EXCEPT the
  // country selection, so the chips do not jump while you are picking one.
  const allowed = allowedCountries(f);
  const facetWhere = radarFacetWhere(f, poolNewest);
  const [countryCounts, remoteCount, unknownCount] = await Promise.all([
    prisma.job.groupBy({ by: ["country"], _count: true, where: { AND: [facetWhere, { country: { in: allowed } }] } }),
    prisma.job.count({ where: { AND: [facetWhere, { country: null, workMode: "remote" }] } }),
    prisma.job.count({ where: { AND: [facetWhere, { country: null, workMode: { not: "remote" } }] } }),
  ]);
  const counts = new Map(countryCounts.map((c) => [c.country as string, c._count]));
  const { top: topCountries, other: otherCountries, otherCount } = countryChips(f, counts);

  const countrySet = new Set(
    f.countries.filter((c) => topCountries.includes(c) || ["other", "remote", "unknown"].includes(c)),
  );
  const country = [...countrySet].sort().join(",");
  const where = radarWhere(f, { poolNewest, top: topCountries, other: otherCountries });

  // One wave, not three. The starred strip and the applied-company set used to
  // be awaited on their own after this block, so a page load waited on five
  // round trips in sequence where three would do.
  const [jobs, filteredCount, snapshot, starred, appliedRows] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: [...RADAR_ORDER],
      ...radarPaging(f),
      // Only the tiny coverLetter field crosses the content split — 30 rows,
      // usually null; descriptions stay out of the list path entirely.
      include: { content: { select: { coverLetter: true } } },
    }),
    prisma.job.count({ where }),
    // The stat strip reads the ingest-end snapshot — one row instead of
    // group-by'ing half a million (measured cause of slow filter clicks).
    prisma.dashboardStatsSnapshot.findFirst({ orderBy: { at: "desc" } }),
    // Starred ("interested") postings — a compact always-visible shortlist
    // above the discovery list, unaffected by the filters. Bounded: this had no
    // `take`, so a user who starred liberally would have paid for an unbounded
    // read on every page load.
    prisma.job.findMany({
      where: { ...liveWhere(), status: "interested" },
      orderBy: [{ fitScore: { sort: "desc", nulls: "last" } }, { score: "desc" }],
      take: STARRED_MAX,
    }),
    // Companies with an application in progress — their remaining postings get
    // a badge and a one-click "hide the rest" (born from 14 manual dismissals).
    prisma.job.findMany({ where: pursuedWhere(), select: { company: true }, distinct: ["company"] }),
  ]);
  const snap = snapshot
    ? (JSON.parse(snapshot.stats) as { total: number; byStatus: Record<string, number>; byVerdict: Record<string, number> })
    : { total: 0, byStatus: {}, byVerdict: {} };
  const appliedCompanies = new Set(appliedRows.map((r) => r.company));
  // One clock and one pool reading for every card on the page, so two postings
  // rendered in the same response cannot be judged fresh against different
  // instants.
  const labelCtx = { now: new Date(), poolNewest: poolNewest ?? undefined, appliedCompanies };

  const sc = snap.byStatus;
  const vc = snap.byVerdict;
  const total = snap.total;
  const lastPage = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));

  // Build hrefs that preserve every other filter (page resets on filter change).
  const href = (over: Partial<Record<"track" | "verdict" | "loc" | "q" | "page" | "region" | "country" | "visa", string>>) => {
    const p = new URLSearchParams();
    const merged = { track, verdict, loc, q, region, country, visa, page: "", ...over };
    if (merged.track) p.set("track", merged.track);
    if (merged.verdict !== "all") p.set("verdict", merged.verdict);
    if (merged.loc) p.set("loc", merged.loc);
    if (merged.region) p.set("region", merged.region);
    if (merged.country) p.set("country", merged.country);
    if (merged.visa) p.set("visa", merged.visa);
    if (merged.q) p.set("q", merged.q);
    if (merged.page && merged.page !== "1") p.set("page", merged.page);
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };

  // Carry the active filter set to the tracking pages so their "radar" link
  // can restore it — filters must survive a round-trip through /applied.
  const radarQS = href({ page: String(page) }).split("?")[1] ?? "";
  const fromQS = radarQS ? `?from=${encodeURIComponent(radarQS)}` : "";

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
          {verdict !== "all" && <input type="hidden" name="verdict" value={verdict} />}
          {loc && <input type="hidden" name="loc" value={loc} />}
          <input name="q" defaultValue={q} placeholder="Search title or company" aria-label="Search jobs" />
        </form>
        <nav className="pages">
          <a className="chip active" href="/">radar</a>
          <a className="chip" href={`/applied${fromQS}`}>applications</a>
          <a className="chip" href={`/dismissed${fromQS}`}>dismissed</a>
          <a className="chip" href="/profile">profile</a>
        </nav>
        <form action={triggerIngest}>
          <button className="btn primary" type="submit">Scan for new jobs</button>
        </form>
      </header>

      <div className="statstrip">
        <span><b>{total}</b> tracked</span>
        <span className="s-strong"><b>{vc["strong"] ?? 0}</b> strong</span>
        <span className="s-possible"><b>{vc["possible"] ?? 0}</b> possible</span>
        <a href={`/applied${fromQS}`}><b>{PURSUED_STATUSES.reduce((n, st) => n + (sc[st] ?? 0), 0)}</b> in progress</a>
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
          {VISA_TIERS.map((v) => {
            const next = new Set(visaSet);
            if (next.has(v)) next.delete(v); else next.add(v);
            return (
              <a key={v} href={href({ visa: [...next].sort().join(",") })}
                 className={`chip ${visaSet.has(v) ? "active" : ""}`}>{VISA_TIER_LABELS[v]}</a>
            );
          })}
        </div>
      </div>

      {starred.length > 0 && (
        <section className="starred">
          <h2 className="grouphead">★ Interested ({starred.length})</h2>
          {starred.map((j) => (
            <article className="job trackrow" key={j.id}>
              <div className="jobmain">
                <p className="title">
                  {j.fitScore != null && (
                    <span
                      className={`fitnum-inline v-${j.fitVerdict}${isVerdictStale(j) ? " verdict-stale" : ""}`}
                      title={isVerdictStale(j) ? staleVerdictTitle(j) : undefined}
                    >{j.fitScore}</span>
                  )}{" "}
                  <a href={j.url} target="_blank" rel="noopener noreferrer">{j.title}</a>
                </p>
                <div className="meta">
                  {j.company}
                  {j.location ? ` · ${j.location}` : ""}{" "}
                  {/* The same labels the main card uses. This strip used to
                      render sponsorReg as "sponsor✓" while the card rendered
                      the derived tier as "sponsor?" for the very same posting —
                      1,920 of them. One vocabulary, one column. */}
                  <Badges labels={postingLabels(j, labelCtx).filter((l) => l.kind === "visa")} />
                </div>
              </div>
              <div className="actions">
                <form action={setStatus}>
                  <input type="hidden" name="id" value={j.id} />
                  <input type="hidden" name="status" value="applied" />
                  <button className="btn act" type="submit">Mark applied</button>
                </form>
                <form action={setStatus}>
                  <input type="hidden" name="id" value={j.id} />
                  <input type="hidden" name="status" value="new" />
                  <button className="btn quiet" type="submit">Unstar</button>
                </form>
              </div>
            </article>
          ))}
        </section>
      )}

      {jobs.length === 0 ? (
        <div className="empty">
          No jobs match these filters.
          <div className="hint">Clear a filter, or run a scan to pull fresh listings.</div>
        </div>
      ) : (
        jobs.map((j) => {
          const labels = postingLabels(j, labelCtx);
          const appliedHere = appliedCompanies.has(j.company);
          return (
          <article className="job" key={j.id}>
            <div className="fitcell">
              {/* One axis, not two. There used to be a `fitBy` branch above
                  this one splitting scores by which MODEL judged them, and
                  because it came first a pre-27B score could never also be
                  marked stale — the two tests were mutually exclusive by
                  construction while asking the same question. The question is
                  "did the system we still trust produce this", and
                  fitPromptVersion answers it; a model name is a weaker proxy
                  that goes quietly wrong the day the model changes. */}
              {j.fitScore != null ? (
                  <div
                    className={isVerdictStale(j) ? "verdict-stale" : undefined}
                    title={isVerdictStale(j) ? staleVerdictTitle(j) : undefined}
                  >
                    <div className={`fitnum v-${j.fitVerdict}`}>{j.fitScore}</div>
                    <div className="gauge"><span className={`v-${j.fitVerdict}`} style={{ width: `${j.fitScore}%` }} /></div>
                    <div className={`vlabel v-${j.fitVerdict}`}>
                      {j.fitVerdict}{isVerdictStale(j) ? " · old" : ""}
                    </div>
                  </div>
              ) : (
                <>
                  <div className="fitnum unscored">{j.score}</div>
                  <div className="vlabel unscored">keyword</div>
                </>
              )}

              {/* Risks are disclosed here rather than used to hide the card.
                  Both were previously reasons a posting never appeared: the
                  age filter dropped it outright, and ghost risk was a badge
                  buried among the meta chips. Neither is a reason to decide
                  for the reader — an evergreen posting can be a real opening
                  (Ashby reports Elicit's still-listed ML role as published in
                  2021) and a ghost flag is a judgement worth showing, not
                  acting on silently. */}
              {labels.filter((l) => l.kind === "freshness" || l.kind === "ghost-risk").map((l) => (
                <div key={l.kind} className={l.kind === "ghost-risk" ? "risk warn" : "risk"} title={l.title}>
                  {l.text}
                </div>
              ))}
            </div>

            <div className="jobmain">
              <p className="title">
                <a href={j.url} target="_blank" rel="noopener noreferrer">{j.title}</a>
              </p>
              <div className="meta">
                <Badges labels={labels.filter((l) => l.kind !== "freshness" && l.kind !== "ghost-risk")} />
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
              {j.content?.coverLetter && (
                <details className="cover">
                  <summary>cover letter draft</summary>
                  <pre>{j.content.coverLetter}</pre>
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
              <details className="dismissmenu">
                <summary>Dismiss</summary>
                <div className="reasonpop">
                  {DISMISS_REASONS.map((r) => (
                    <form action={setStatus} key={r.key}>
                      <input type="hidden" name="id" value={j.id} />
                      <input type="hidden" name="status" value="ignored" />
                      <input type="hidden" name="reason" value={r.key} />
                      <button className="btn quiet" type="submit">{r.label}</button>
                    </form>
                  ))}
                  <form action={setStatus}>
                    <input type="hidden" name="id" value={j.id} />
                    <input type="hidden" name="status" value="ignored" />
                    <button className="btn quiet" type="submit">Just dismiss</button>
                  </form>
                  {appliedHere && (
                    <form action={dismissCompanyRest}>
                      <input type="hidden" name="company" value={j.company} />
                      <button className="btn act" type="submit">Hide all from {j.company.slice(0, 20)}</button>
                    </form>
                  )}
                </div>
              </details>
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
