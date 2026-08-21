import { prisma } from "@/lib/db";
import { setStatus } from "../actions";

export const dynamic = "force-dynamic";

// Dismissed jobs ("ignored" in the DB, kept for history). One-click restore —
// dismissing on the radar is deliberately confirmation-free because this page
// is the undo.

export default async function DismissedPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  // "from" carries the radar's filter query string so the round-trip
  // radar → here → radar lands back on the same filtered view.
  const from = (await searchParams).from ?? "";
  const radarHref = from ? `/?${from}` : "/";
  const fromQS = from ? `?from=${encodeURIComponent(from)}` : "";
  const jobs = await prisma.job.findMany({
    where: { status: "ignored" },
    orderBy: [{ lastSeenAt: "desc" }],
    take: 300,
  });

  return (
    <main className="wrap">
      <header className="top">
        <div className="brand">
          <div>
            <h1>DISMISSED</h1>
            <div className="sub">{jobs.length} hidden from the radar</div>
          </div>
        </div>
        <nav className="pages">
          <a className="chip" href={radarHref}>radar</a>
          <a className="chip" href={`/applied${fromQS}`}>applications</a>
          <a className="chip active" href={`/dismissed${fromQS}`}>dismissed</a>
        </nav>
      </header>

      {jobs.map((j) => (
        <article className="job trackrow" key={j.id}>
          <div className="jobmain">
            <p className="title">
              <a href={j.url} target="_blank" rel="noopener noreferrer">{j.title}</a>
            </p>
            <div className="meta">
              {j.company}
              {j.location ? ` · ${j.location}` : ""}
              {" · "}
              <span className="src">{j.source}</span>
            </div>
          </div>
          <div className="actions">
            <form action={setStatus}>
              <input type="hidden" name="id" value={j.id} />
              <input type="hidden" name="status" value="new" />
              <button className="btn" type="submit">Restore</button>
            </form>
          </div>
        </article>
      ))}
      {jobs.length === 0 && <p className="empty">Nothing dismissed.</p>}
    </main>
  );
}
