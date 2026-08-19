import { prisma } from "@/lib/db";
import { profile } from "@/lib/profile";
import {
  ageLabel,
  classifyFreshness,
  DELISTED_AFTER_DAYS,
  FRESH_MAX_DAYS,
} from "@/lib/freshness";
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
  searchParams: Promise<{ track?: string; status?: string; verdict?: string; loc?: string; q?: string; page?: string; age?: string }>;
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

  // The pool's own clock: how far the newest observation has advanced. Guards
  // the delisted check against "we simply haven't ingested lately".
  const poolNewest = (await prisma.job.aggregate({ _max: { lastSeenAt: true } }))._max.lastSeenAt;

  if (age === "fresh") {
    const now = Date.now();
    const freshCutoff = new Date(now - FRESH_MAX_DAYS * 86_400_000);
    const clauses: any[] = [
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
  const href = (over: Partial<Record<"track" | "status" | "verdict" | "loc" | "q" | "page" | "age", string>>) => {
    const p = new URLSearchParams();
    const merged = { track, status, verdict, loc, q, age, page: "", ...over };
    if (merged.track) p.set("track", merged.track);
    if (merged.status !== "active") p.set("status", merged.status);
    if (merged.verdict !== "all") p.set("verdict", merged.verdict);
    if (merged.loc) p.set("loc", merged.loc);
    if (merged.age !== "fresh") p.set("age", merged.age);
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
