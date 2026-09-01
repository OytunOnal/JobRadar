import { prisma } from "@/lib/db";
import { saveNote, setFollowUp, setStatus } from "../actions";
import { postingLabels } from "@/lib/view/labels";
import { FitScore } from "@/lib/view/FitScore";
import { TRACKED_STATUSES, trackedWhere } from "@/lib/queue/pool";
import { followUpDue, ghostSuggested } from "@/lib/queue/pursuit";
import { ageWords } from "@/lib/scoring/freshness";

export const dynamic = "force-dynamic";

// The application tracker: everything the user has applied to, grouped by
// stage, with follow-up nudges on top. Discovery lives on "/"; this page is
// the pipeline. Job text is stored locally, so an application survives its
// posting being taken down — with a warning when that happens.

const GROUPS: Array<{ status: string; label: string }> = [
  { status: "applied", label: "Applied" },
  { status: "interview", label: "Interviewing" },
  // Not a failure and not an outcome: the employer froze the req. It sits
  // among the states you are still waiting in rather than beside the two
  // endings, because it is one — on a slower clock.
  { status: "stopped", label: "Hiring paused" },
  { status: "offer", label: "Offer" },
  { status: "rejected", label: "Rejected" },
  { status: "ghosted", label: "Ghosted" },
];
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
  // Lifecycle rules come from queue/pursuit.ts — a render function is where
  // one of them used to live, which meant it could only be tested by
  // rendering. The page asks; it does not decide.
  const dueToday = jobs.filter((j) => followUpDue(j, nowDate));

  // `nudges` is required rather than defaulted, so neither call site can be
  // written as `list.map(card)` — map would hand the index in as the flag and
  // the buttons would appear on every card but the first. A required boolean
  // makes that a compile error instead of a rendering mystery.
  const card = (j: (typeof jobs)[number], nudges: boolean) => {
    const ghostSuggest = ghostSuggested(j, nowDate);
    return (
      <article className="job trackrow" key={j.id}>
        <div className="jobmain">
          <p className="title">
            {/* The judge's number, same rendering the radar uses — including
                the fade on a verdict an older prompt produced. A pursuit is
                where you decide whether to keep spending on a role, and the
                page that tracks it was the one page that did not say what the
                judge thought of it. */}
            <FitScore job={j} />{" "}
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
          {/* The corner is the pursuit clock: where this one stands, and how
              long it has stood there. "applied 2026-08-21" is a record; the
              number you actually reason about is how long the silence has
              lasted, because that is what turns "waiting" into "they are not
              going to answer". The exact date is one hover away. */}
          <div className="status-pill">
            {j.status}
            {j.appliedAt && (
              <span className="agechip" title={`Applied ${fmt(j.appliedAt)}`}>
                {ageWords(j.appliedAt, nowDate)}
              </span>
            )}
          </div>
          {TRACKED_STATUSES.filter((s) => s !== j.status).map((s) => (
            <form action={setStatus} key={s}>
              <input type="hidden" name="id" value={j.id} />
              <input type="hidden" name="status" value={s} />
              <button className="btn" type="submit">{s}</button>
            </form>
          ))}
          {/* THE NUDGE CONTROLS BELONG TO THE NUDGE, NOT TO THE CARD.
              They used to render on all 23 tracked cards, which asked a
              question nobody was being asked: "+3d" on a card whose reminder
              is nine days out defers a date the card no longer even shows.
              They are the answer to being interrupted, so they live where the
              interruption is. A card whose date has arrived appears twice on
              this page, once in the nudge section with these and once in its
              own group without them. */}
          {nudges && (
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
          {dueToday.map((j) => card(j, true))}
        </section>
      )}

      {GROUPS.map(({ status, label }) => {
        const group = jobs.filter((j) => j.status === status);
        if (group.length === 0) return null;
        return (
          <section key={status}>
            <h2 className="grouphead">{label} ({group.length})</h2>
            {group.map((j) => card(j, false))}
          </section>
        );
      })}
      {jobs.length === 0 && <p className="empty">Nothing yet — mark a job as applied on the radar.</p>}
    </main>
  );
}
