import { prisma } from "@/lib/db";
import { saveNote, setFollowUp, setStatus } from "../actions";
import { postingLabels } from "@/lib/view/labels";
import { isAwaitingReply, TRACKED_STATUSES, trackedWhere } from "@/lib/queue/pool";

export const dynamic = "force-dynamic";

// The application tracker: everything the user has applied to, grouped by
// stage, with follow-up nudges on top. Discovery lives on "/"; this page is
// the pipeline. Job text is stored locally, so an application survives its
// posting being taken down — with a warning when that happens.

const GROUPS: Array<{ status: string; label: string }> = [
  { status: "applied", label: "Applied" },
  { status: "interview", label: "Interviewing" },
  { status: "offer", label: "Offer" },
  { status: "rejected", label: "Rejected" },
  { status: "ghosted", label: "Ghosted" },
];
const GHOST_SUGGEST_DAYS = 14; // follow-up long overdue and still silent

function fmt(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

export default async function AppliedPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  // "from" carries the radar's filter query string so the round-trip
  // radar → here → radar lands back on the same filtered view.
  const from = (await searchParams).from ?? "";
  const radarHref = from ? `/?${from}` : "/";
  const fromQS = from ? `?from=${encodeURIComponent(from)}` : "";
  const [jobs, poolNewest] = await Promise.all([
    prisma.job.findMany({ where: trackedWhere(), orderBy: [{ appliedAt: "desc" }] }),
    // The pool's own clock, so "gone from the source" is judged the same way
    // here as on the radar rather than against wall-clock time.
    prisma.job.aggregate({ _max: { lastSeenAt: true } }).then((a) => a._max.lastSeenAt),
  ]);
  const nowDate = new Date();
  const now = nowDate.getTime();
  const dueToday = jobs.filter(
    (j) => j.followUpAt && j.followUpAt.getTime() <= now && isAwaitingReply(j.status),
  );

  const card = (j: (typeof jobs)[number]) => {
    const ghostSuggest =
      j.status === "applied" &&
      j.followUpAt &&
      now - j.followUpAt.getTime() > GHOST_SUGGEST_DAYS * 86_400_000;
    return (
      <article className="job trackrow" key={j.id}>
        <div className="jobmain">
          <p className="title">
            <a href={j.url} target="_blank" rel="noopener noreferrer">{j.title}</a>
          </p>
          <div className="meta">
            {j.company}
            {j.location ? ` · ${j.location}` : ""}{" "}
            {/* The radar's vocabulary, not a second one. These three badges
                used to be written here by hand: sponsor✓ from `sponsorReg`
                (where the radar's card reads the derived tier and says
                sponsor?), and "⚠ posting closed" from a bare `delistedAt`
                where the radar uses the broader, tested classifier — so a
                posting its source had stopped listing could show closed on one
                page and nothing on the other. */}
            {postingLabels(j, { now: nowDate, poolNewest: poolNewest ?? undefined })
              .filter((l) => l.kind === "visa" || l.kind === "delisted")
              .map((l) => (
                <span key={l.kind} className={`badge t-${l.tone}`} title={l.title}>{l.text}</span>
              ))}
            {" · applied "}{fmt(j.appliedAt)}
            {j.followUpAt && ` · follow-up ${fmt(j.followUpAt)}`}
            {" · "}
            <span className="src">{j.source}</span>
          </div>
          {ghostSuggest && (
            <div className="reason">
              No reply long past the follow-up date — mark as ghosted?{" "}
              <form action={setStatus} style={{ display: "inline" }}>
                <input type="hidden" name="id" value={j.id} />
                <input type="hidden" name="status" value="ghosted" />
                <button className="btn quiet" type="submit">Ghosted</button>
              </form>
            </div>
          )}
          <form action={saveNote} className="noteform">
            <input type="hidden" name="id" value={j.id} />
            <input name="note" defaultValue={j.note ?? ""} placeholder="note (contact, next step…)" />
            <button className="btn" type="submit">Save</button>
          </form>
        </div>
        <div className="actions">
          <div className="status-pill">{j.status}</div>
          {TRACKED_STATUSES.filter((s) => s !== j.status).map((s) => (
            <form action={setStatus} key={s}>
              <input type="hidden" name="id" value={j.id} />
              <input type="hidden" name="status" value={s} />
              <button className="btn" type="submit">{s}</button>
            </form>
          ))}
          {isAwaitingReply(j.status) && (
            <>
              {["3", "7"].map((d) => (
                <form action={setFollowUp} key={d}>
                  <input type="hidden" name="id" value={j.id} />
                  <input type="hidden" name="days" value={d} />
                  <button className="btn quiet" type="submit">+{d}d</button>
                </form>
              ))}
              {j.followUpAt && (
                <form action={setFollowUp}>
                  <input type="hidden" name="id" value={j.id} />
                  <input type="hidden" name="days" value="clear" />
                  <button className="btn quiet" type="submit">no nudge</button>
                </form>
              )}
            </>
          )}
        </div>
      </article>
    );
  };

  return (
    <main className="wrap">
      <header className="top">
        <div className="brand">
          <div>
            <h1>APPLICATIONS</h1>
            <div className="sub">{jobs.length} in the pipeline</div>
          </div>
        </div>
        <nav className="pages">
          <a className="chip" href={radarHref}>radar</a>
          <a className="chip active" href={`/applied${fromQS}`}>applications</a>
          <a className="chip" href={`/dismissed${fromQS}`}>dismissed</a>
          <a className="chip" href="/profile">profile</a>
        </nav>
      </header>

      {dueToday.length > 0 && (
        <section className="followups">
          <h2>🔔 Follow up today ({dueToday.length})</h2>
          {dueToday.map(card)}
        </section>
      )}

      {GROUPS.map(({ status, label }) => {
        const group = jobs.filter((j) => j.status === status);
        if (group.length === 0) return null;
        return (
          <section key={status}>
            <h2 className="grouphead">{label} ({group.length})</h2>
            {group.map(card)}
          </section>
        );
      })}
      {jobs.length === 0 && <p className="empty">Nothing yet — mark a job as applied on the radar.</p>}
    </main>
  );
}
