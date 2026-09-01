import { profile } from "@/lib/user/profile";
import { ageLabel } from "@/lib/scoring/freshness";
import { COUNTRY_NAMES, REGION_KEYS } from "@/lib/location/geo";
import { setStatus, triggerIngest, draftCover, analyzeFitAction, dismissCompanyRest } from "./actions";
import { DISMISS_REASONS } from "@/lib/view/dismiss-reasons";
import { readRadar } from "@/lib/view/radar-read";
import { isVerdictStale, postingLabels, staleVerdictTitle, VISA_LABELS, VISA_TIERS } from "@/lib/view/labels";
import { Badges } from "@/lib/view/Badges";

// The title line describes what the job IS — its track, where it happens —
// and everything else a card says is an ASSESSMENT, which lives under the
// score with the verdict that produced it. One card, two registers: facts up
// top with the name, judgements in the judgement column.
const FACT_LABELS = new Set(["track", "work-mode"]);
import { FitScore } from "@/lib/view/FitScore";
import { radarFilters, VERDICTS, WORK_MODES } from "@/lib/view/radar";

export const dynamic = "force-dynamic";

// Track chips come from the user's configured tracks (config/user.ts override,
// generated profile, or the template defaults). Multi-select; "all" clears.
const TRACK_KEYS = profile.tracks.map((t) => t.key);

// Half a million is the point of the stat strip; `526367` reads as noise and
// `526,367` reads as a number. Same spelling the profile page uses.
const fmt = (v: number): string => v.toLocaleString("en");


// Labels carry MEANING (`tone`), not placement. The page decides what a risk
// looks like and where it goes; the rule module decides what is one.
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

  // The reading — nine queries in three waves — lives in view/radar-read.ts,
  // where its invariants are tested against a real database. The page asks
  // once and lays the answer out; it decides nothing and sequences nothing.
  const { jobs, filteredCount, lastPage, chips, stats, starred, appliedCompanies, pursuedCount, labelCtx, descriptions } =
    await readRadar(f);
  const { top: topCountries, otherCount, counts, remoteCount, unknownCount } = chips;
  // The selection the query was actually built from — not re-derived here, so
  // the chip active-state cannot diverge from the list it claims to filter.
  const countrySet = new Set(chips.selected);
  const country = [...countrySet].sort().join(",");
  const vc = stats.byVerdict;
  const total = stats.total;

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
        <span><b>{fmt(total)}</b> tracked</span>
        <span className="s-strong"><b>{fmt(vc["strong"] ?? 0)}</b> strong</span>
        <span className="s-possible"><b>{fmt(vc["possible"] ?? 0)}</b> possible</span>
        <a href={`/applied${fromQS}`}><b>{fmt(pursuedCount)}</b> in progress</a>
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
                 className={`chip ${countrySet.has(c) ? "active" : ""}`}>{COUNTRY_NAMES[c] ?? c} {fmt(counts.get(c) ?? 0)}</a>
            );
          })}
          {([["other", otherCount], ["remote", remoteCount], ["unknown", unknownCount]] as const).map(([b, n]) => {
            if (n === 0 && !countrySet.has(b)) return null;
            const next = new Set(countrySet);
            if (next.has(b)) next.delete(b); else next.add(b);
            return (
              <a key={b} href={href({ country: [...next].sort().join(",") })}
                 className={`chip ${countrySet.has(b) ? "active" : ""}`}>{b} {fmt(n)}</a>
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
                 className={`chip ${visaSet.has(v) ? "active" : ""}`}>{VISA_LABELS[v].chip}</a>
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
                  <FitScore job={j} />{" "}
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

              {/* Everything the SYSTEM says about this posting, stacked
                  under the system's number. The title line keeps only what
                  the job IS — track and where it happens — and the verdict
                  column carries the assessments: risks, the visa reading,
                  the language barrier, the judge's cap, applied@co.

                  Risks are disclosed here rather than used to hide the card.
                  Both were previously reasons a posting never appeared: the
                  age filter dropped it outright, and ghost risk was a badge
                  buried among the meta chips. Neither is a reason to decide
                  for the reader — an evergreen posting can be a real opening
                  (Ashby reports Elicit's still-listed ML role as published in
                  2021) and a ghost flag is a judgement worth showing, not
                  acting on silently. */}
              <div className="fitlabels">
                <Badges labels={labels.filter((l) => !FACT_LABELS.has(l.kind))} />
              </div>
            </div>

            <div className="jobmain">
              <p className="title">
                <a href={j.url} target="_blank" rel="noopener noreferrer">{j.title}</a>
              </p>
              <div className="meta">
                <Badges labels={labels.filter((l) => FACT_LABELS.has(l.kind))} />
                {j.company}
                {j.location ? ` · ${j.location}` : ""}
                {j.salaryText ? ` · ${j.salaryText}` : ""}
                {" · "}
                <span className="src">{j.source}</span>
                {" · "}
                <span className="src" title={j.postedAt ? "posted" : "first seen"}>
                  {ageLabel(j.postedAt ?? j.firstSeenAt, labelCtx.now)}
                </span>
              </div>
              {j.fitComment && <div className="fitcomment">{j.fitComment}</div>}
              {j.scoreReason && <div className="reason">{j.scoreReason}</div>}
              {/* The posting itself. Closed, so the browser paints none of
                  it, and open with no round trip because the text came down
                  with the page — the reading fetches this page's thirty by id
                  in 5ms, which is what makes a plain <details> the right
                  control rather than a link that reloads. */}
              {descriptions.get(j.id) && (
                <details className="posting">
                  <summary>the posting</summary>
                  <pre>{descriptions.get(j.id)}</pre>
                </details>
              )}
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
