import { prisma } from "@/lib/db";
import { saveNote, setFollowUp, setStatus } from "../actions";

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
const STAGES = ["applied", "interview", "offer", "rejected", "ghosted"];
const GHOST_SUGGEST_DAYS = 14; // follow-up long overdue and still silent

function fmt(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

export default async function AppliedPage() {
  const jobs = await prisma.job.findMany({
    where: { status: { in: STAGES } },
    orderBy: [{ appliedAt: "desc" }],
  });
  const now = Date.now();
  const dueToday = jobs.filter(
    (j) => j.followUpAt && j.followUpAt.getTime() <= now && (j.status === "applied" || j.status === "interview"),
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
            {j.location ? ` · ${j.location}` : ""}
            {j.sponsorReg && <span className="badge s-strong"> sponsor✓</span>}
            {j.visa === "yes" && <span className="badge s-strong"> visa</span>}
            {j.delistedAt && (
              <span className="badge age-delisted" title="The posting was taken down at the source — the role may be filled or closed.">
                ⚠ posting closed
              </span>
            )}
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
          {STAGES.filter((s) => s !== j.status).map((s) => (
            <form action={setStatus} key={s}>
              <input type="hidden" name="id" value={j.id} />
              <input type="hidden" name="status" value={s} />
              <button className="btn" type="submit">{s}</button>
            </form>
          ))}
          {(j.status === "applied" || j.status === "interview") && (
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
    <main>
      <header className="top">
        <div className="brand">
          <div>
            <h1>APPLICATIONS</h1>
            <div className="sub">{jobs.length} in the pipeline</div>
          </div>
        </div>
        <nav className="pages">
          <a className="chip" href="/">radar</a>
          <a className="chip active" href="/applied">applications</a>
          <a className="chip" href="/dismissed">dismissed</a>
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
