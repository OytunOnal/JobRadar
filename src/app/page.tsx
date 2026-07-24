import { prisma } from "@/lib/db";
import { profile } from "@/lib/profile";
import { setStatus, triggerIngest, draftCover, analyzeFitAction } from "./actions";

export const dynamic = "force-dynamic";

const TRACKS = ["all", "playable", "unity", "ai", "fullstack"] as const;
const STATUSES = ["new", "interested", "applied", "interview", "offer", "rejected"] as const;

function scoreClass(n: number) {
  return n >= 70 ? "high" : n >= 40 ? "mid" : "low";
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ track?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const track = sp.track ?? "all";
  const status = sp.status ?? "active";

  const where: any = {};
  if (track !== "all") where.track = track;
  if (status === "active") where.status = { in: ["new", "interested", "applied", "interview"] };
  else if (status !== "all") where.status = status;

  const jobs = await prisma.job.findMany({
    where,
    // LLM-analyzed jobs (real fit) rank first; the rest fall back to keyword score.
    orderBy: [
      { fitScore: { sort: "desc", nulls: "last" } },
      { score: "desc" },
      { createdAt: "desc" },
    ],
    take: 100,
  });

  const counts = await prisma.job.groupBy({ by: ["status"], _count: true });
  const countMap = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  const total = counts.reduce((a, c) => a + c._count, 0);

  const mkHref = (t: string, s: string) => `/?track=${t}&status=${s}`;

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>JobRadar</h1>
          <div className="sub">{profile.name} — job discovery &amp; application tracker</div>
        </div>
        <form action={triggerIngest} className="ingest-bar">
          <button className="btn primary" type="submit">↻ Fetch new jobs</button>
        </form>
      </header>

      <div className="stats">
        <div className="stat"><div className="n">{total}</div><div className="l">tracked</div></div>
        <div className="stat"><div className="n">{countMap["new"] ?? 0}</div><div className="l">new</div></div>
        <div className="stat"><div className="n">{countMap["applied"] ?? 0}</div><div className="l">applied</div></div>
        <div className="stat"><div className="n">{countMap["interview"] ?? 0}</div><div className="l">interview</div></div>
      </div>

      <div className="filters">
        {TRACKS.map((t) => (
          <a key={t} href={mkHref(t, status)} className={`chip ${track === t ? "active" : ""}`}>
            {t}
          </a>
        ))}
      </div>
      <div className="filters">
        {["active", "all", ...STATUSES].map((s) => (
          <a key={s} href={mkHref(track, s)} className={`chip ${status === s ? "active" : ""}`}>
            {s}
          </a>
        ))}
      </div>

      {jobs.length === 0 ? (
        <div className="empty">No jobs match this filter. Try &quot;Fetch new jobs&quot; or widen the filters.</div>
      ) : (
        jobs.map((j) => (
          <div className="job" key={j.id}>
            <div className={`score ${scoreClass(j.score)}`}>{j.score}</div>
            <div>
              <p className="title">
                <a href={j.url} target="_blank" rel="noopener noreferrer">{j.title}</a>
              </p>
              <div className="meta">
                {j.track && <span className={`badge ${j.track}`}>{j.track}</span>}
                {j.remote && <span className="badge remote">remote</span>}
                {j.company}
                {j.location ? ` · ${j.location}` : ""}
                {j.salaryText ? ` · ${j.salaryText}` : ""}
                {" · "}
                <span style={{ color: "var(--muted)" }}>{j.source}</span>
              </div>
              {j.scoreReason && <div className="reason">{j.scoreReason}</div>}
              {j.fitComment && (
                <div className={`fit fit-${j.fitVerdict ?? "weak"}`}>
                  <strong>Fit {j.fitScore}/100 · {j.fitVerdict}</strong> — {j.fitComment}
                </div>
              )}
              {j.coverLetter && (
                <details className="cover" open>
                  <summary>Cover letter draft</summary>
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
                  <button className="btn primary" type="submit">Applied</button>
                </form>
              )}
              {j.status !== "interested" && (
                <form action={setStatus}>
                  <input type="hidden" name="id" value={j.id} />
                  <input type="hidden" name="status" value="interested" />
                  <button className="btn" type="submit">★ Interested</button>
                </form>
              )}
              <form action={analyzeFitAction}>
                <input type="hidden" name="id" value={j.id} />
                <button className="btn" type="submit">◎ Analyze fit</button>
              </form>
              <form action={draftCover}>
                <input type="hidden" name="id" value={j.id} />
                <button className="btn" type="submit">✍ Draft letter</button>
              </form>
              <form action={setStatus}>
                <input type="hidden" name="id" value={j.id} />
                <input type="hidden" name="status" value="ignored" />
                <button className="btn" type="submit">Dismiss</button>
              </form>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
