import { prisma } from "@/lib/db";
import { profile } from "@/lib/profile";
import { FIT_PROMPT_VERSION } from "@/lib/fit";
import { ageLabel, classifyFreshness, DELISTED_AFTER_DAYS } from "@/lib/freshness";
import { COUNTRY_NAMES, REGION_KEYS, REGIONS } from "@/lib/geo";
import { setStatus, triggerIngest, draftCover, analyzeFitAction, dismissCompanyRest } from "./actions";
import { DISMISS_REASONS } from "@/lib/dismiss-reasons";
import { detectLanguageRequirements, LANG_NAMES } from "@/lib/langreq";

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
// The visa axis: a derived tier, not raw evidence (see lib/visa.ts). Hidden
// entirely when the profile says no sponsorship is needed anywhere.
const VISA_TIERS = ["yes", "maybe", "no", "unknown", "not-needed"] as const;
const VISA_TIER_LABELS: Record<(typeof VISA_TIERS)[number], string> = {
  yes: "visa: yes", maybe: "visa: maybe", no: "visa: no",
  unknown: "visa: unknown", "not-needed": "no visa needed",
};
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
  searchParams: Promise<{ track?: string; status?: string; verdict?: string; loc?: string; q?: string; page?: string; region?: string; country?: string; visa?: string }>;
}) {
  const sp = await searchParams;
  // track is a comma list of track keys; empty = all.
  const trackSet = new Set(
    (sp.track ?? "").split(",").map((s) => s.trim()).filter((s) => TRACK_KEYS.includes(s)),
  );
  const track = [...trackSet].sort().join(",");
  const status = "active"; // Radar is discovery-only; /applied and /dismissed have their own pages
  const verdict = sp.verdict ?? "all";
  // loc is a comma list of work modes (e.g. "remote,hybrid"); empty = all.
  const locSet = new Set(
    (sp.loc ?? "").split(",").map((s) => s.trim()).filter((s) => WORK_MODES.some((m) => m.value === s)),
  );
  const loc = [...locSet].sort().join(",");
  // region: comma list of region keys; country: comma list of alpha-2 codes
  // plus the special buckets "other" | "remote" | "unknown".
  const regionSet = new Set(
    (sp.region ?? "").split(",").map((s) => s.trim()).filter((s) => REGION_KEYS.includes(s)),
  );
  const region = [...regionSet].sort().join(",");
  const countryParam = new Set((sp.country ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const visaSet = new Set(
    (sp.visa ?? "").split(",").map((s) => s.trim()).filter((s) => VISA_TIERS.includes(s as never)),
  );
  const visa = [...visaSet].sort().join(",");
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  // Semantic duplicates (reposts of a tracked role) never render.
  const where: any = { duplicateOfId: null };
  const and: any[] = [];
  if (trackSet.size > 0) where.track = { in: [...trackSet] };
  where.status = "new"; // interested jobs render in their own strip above the list
  where.delistedAt = null; // closed roles have no discovery value
  where.disqualified = false; // store-all keeps gate-rejects in the DB, never on the radar
  if (verdict !== "all") where.fitVerdict = verdict;
  if (locSet.size > 0) where.workMode = { in: [...locSet] };
  if (q) and.push({ OR: [{ title: { contains: q } }, { company: { contains: q } }] });
  if (visaSet.size > 0) where.visaTier = { in: [...visaSet] };

  // The pool's own clock: how far the newest observation has advanced. Guards
  // the delisted check against "we simply haven't ingested lately".
  const poolNewest = (await prisma.job.aggregate({ _max: { lastSeenAt: true } }))._max.lastSeenAt;

  // A posting is hidden only when it is GONE, never when it is merely old.
  //
  // The age filter used to drop anything whose postedAt fell outside a 45-day
  // window, and it was measured hiding 74 already-judged postings — 72 of
  // which the model had read and called real openings, 16 of them strong.
  // The reason is that postedAt does not mean what the filter assumed: Ashby
  // reports Elicit's still-open ML Engineer role as published 2021-01-23 with
  // isListed true, because the field records when the record was created, not
  // when the opening appeared. Filtering on it discards live jobs and keeps
  // dead ones whose dates happen to look recent.
  //
  // So age is now DISCLOSED rather than enforced: the card carries a "may not
  // be fresh" badge, and ghost risk — the thing the age filter was really
  // trying to catch — carries its own, judged by a model that read the
  // posting instead of inferred from a date. Hiding decides for the user with
  // worse information than they have.
  const clauses: any[] = [{ delistedAt: null }]; // closed roles are gone, not risky
  if (poolNewest) {
    const delistCutoff = new Date(poolNewest.getTime() - DELISTED_AFTER_DAYS * 86_400_000);
    clauses.push({
      NOT: { AND: [{ source: { contains: ":" } }, { lastSeenAt: { lt: delistCutoff } }] },
    });
  }
  // Jobs being pursued stay visible even after their source drops them.
  and.push({ OR: [{ AND: clauses }, { status: { in: PURSUED } }] });
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

  const [jobs, filteredCount, snapshot] = await Promise.all([
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
      // Only the tiny coverLetter field crosses the content split — 20 rows,
      // usually null; descriptions stay out of the list path entirely.
      include: { content: { select: { coverLetter: true } } },
    }),
    prisma.job.count({ where }),
    // The stat strip reads the ingest-end snapshot — one row instead of
    // group-by'ing half a million (measured cause of slow filter clicks).
    prisma.dashboardStatsSnapshot.findFirst({ orderBy: { at: "desc" } }),
  ]);
  const snap = snapshot
    ? (JSON.parse(snapshot.stats) as { total: number; byStatus: Record<string, number>; byVerdict: Record<string, number> })
    : { total: 0, byStatus: {}, byVerdict: {} };

  // Starred ("interested") jobs — a compact always-visible shortlist above the
  // discovery list, unaffected by the filters.
  const starred = await prisma.job.findMany({
    where: { status: "interested", delistedAt: null, duplicateOfId: null, disqualified: false },
    orderBy: [{ fitScore: { sort: "desc", nulls: "last" } }, { score: "desc" }],
  });

  // Companies with an application in progress — their remaining postings get
  // a badge and a one-click "hide the rest" (born from 14 manual Mistral
  // dismissals).
  const appliedCompanies = new Set(
    (await prisma.job.findMany({
      where: { status: { in: PURSUED } },
      select: { company: true },
      distinct: ["company"],
    })).map((r) => r.company),
  );

  const sc = snap.byStatus;
  const vc = snap.byVerdict;
  const total = snap.total;
  const lastPage = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));

  // Build hrefs that preserve every other filter (page resets on filter change).
  const href = (over: Partial<Record<"track" | "status" | "verdict" | "loc" | "q" | "page" | "region" | "country" | "visa", string>>) => {
    const p = new URLSearchParams();
    const merged = { track, status, verdict, loc, q, region, country, visa, page: "", ...over };
    if (merged.track) p.set("track", merged.track);
    if (merged.status !== "active") p.set("status", merged.status);
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
          {status !== "active" && <input type="hidden" name="status" value={status} />}
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
        <a href={`/applied${fromQS}`}><b>{(sc["applied"] ?? 0) + (sc["interview"] ?? 0) + (sc["offer"] ?? 0)}</b> in progress</a>
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
                      className={`fitnum-inline v-${j.fitVerdict}${j.fitPromptVersion === FIT_PROMPT_VERSION ? "" : " verdict-stale"}`}
                      title={j.fitPromptVersion === FIT_PROMPT_VERSION ? undefined : "Judged by an older version — waiting to be re-judged."}
                    >{j.fitScore}</span>
                  )}{" "}
                  <a href={j.url} target="_blank" rel="noopener noreferrer">{j.title}</a>
                </p>
                <div className="meta">
                  {j.company}
                  {j.location ? ` · ${j.location}` : ""}
                  {j.sponsorReg && <span className="badge s-strong"> sponsor✓</span>}
                  {j.visa === "yes" && <span className="badge s-strong"> visa</span>}
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
          const freshness = classifyFreshness(j, new Date(), poolNewest ?? undefined);
          const langBarriers = (j.langReq ?? "").split(",").filter(Boolean).filter((c) => !profile.languages.includes(c));
          const appliedHere = appliedCompanies.has(j.company);
          return (
          <article className="job" key={j.id}>
            <div className="fitcell">
              {j.fitScore != null ? (
                (j.fitBy ?? "").startsWith("qwen27b") ? (
                  // A verdict is only "current" if THIS prompt produced it.
                  // Every pre-v7 judgment was formed on markup-filled text
                  // read through a blind head-slice, with no salary line and
                  // visa wording reaching the model 24% of the time — a
                  // different system wearing the same number. Faded until the
                  // worker re-judges it, so a stale verdict never reads as a
                  // fresh one.
                  <div
                    className={j.fitPromptVersion === FIT_PROMPT_VERSION ? undefined : "verdict-stale"}
                    title={j.fitPromptVersion === FIT_PROMPT_VERSION
                      ? undefined
                      : `Judged by an older version (${j.fitPromptVersion ?? "?"}) on text we have since repaired — waiting to be re-judged by ${FIT_PROMPT_VERSION}.`}
                  >
                    <div className={`fitnum v-${j.fitVerdict}`}>{j.fitScore}</div>
                    <div className="gauge"><span className={`v-${j.fitVerdict}`} style={{ width: `${j.fitScore}%` }} /></div>
                    <div className={`vlabel v-${j.fitVerdict}`}>
                      {j.fitVerdict}{j.fitPromptVersion === FIT_PROMPT_VERSION ? "" : " · old"}
                    </div>
                  </div>
                ) : (
                  // Pre-27B triage score (8B/free-cloud era, measured ~29%
                  // optimistic): shown muted with a "pre" label until the
                  // 27B pass upgrades it. Ordering is untouched by design.
                  <div title="Pre-triage score (8B era, measured ~29% optimistic) — waiting for the 27B pass.">
                    <div className="fitnum prescore">{j.fitScore}</div>
                    <div className="gauge"><span className="prescore" style={{ width: `${j.fitScore}%` }} /></div>
                    <div className="vlabel prescore">{j.fitVerdict} · pre</div>
                  </div>
                )
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
              {(freshness === "aging" || freshness === "evergreen") && (
                <div
                  className="risk"
                  title={`The source dates this posting ${ageLabel(j.postedAt ?? j.firstSeenAt)} old. That often means the record was created long ago rather than the opening being stale — it is still listed — but treat the date with suspicion.`}
                >may not be fresh</div>
              )}
              {j.ghostRisk && (
                <div
                  className="risk warn"
                  title="The model read this posting and thought it may not be one real, active opening — talent-pool wording, an unnamed client, or contradictory requirements."
                >ghost risk</div>
              )}
            </div>

            <div className="jobmain">
              <p className="title">
                <a href={j.url} target="_blank" rel="noopener noreferrer">{j.title}</a>
              </p>
              <div className="meta">
                {j.track && <span className="badge">{j.track}</span>}
                {j.workMode !== "onsite" && <span className="badge">{j.workMode}</span>}
                {freshness === "delisted" && <span className="badge age-delisted">delisted</span>}
                {j.visa === "yes" && <span className="badge s-strong">visa</span>}
                {j.visaTier === "yes" && (
                  <span className="badge s-strong" title="The posting itself states it sponsors visas / offers relocation.">sponsor✓</span>
                )}
                {j.visaTier === "maybe" && (
                  <span className="badge s-possible" title="The posting is silent, but the company is listed in its country's public sponsor register (NL IND / UK Home Office / DK SIRI / IE DETE) — it CAN sponsor.">sponsor?</span>
                )}
                {langBarriers.length > 0 && (
                  <span className="badge age-evergreen" title="The description appears to require a language outside your profile — verify before applying.">
                    requires {langBarriers.map((c) => LANG_NAMES[c] ?? c).join("/")}
                  </span>
                )}
                {appliedHere && (
                  <span className="badge s-strong" title="You have an application in progress at this company.">
                    applied@co
                  </span>
                )}
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
