# Roadmap

What is planned, and — where the thinking is already done — the decisions
behind it. Nothing here is committed to a date.

## Download it and run it

The same engine as a free, open-source app you download, instead of a clone and
six npm scripts. This is the largest item and the one with the most decided
already.

**Distribution.** GitHub Releases. No app store: the audience is technical
enough for an unsigned binary and a right-click-to-open note, and a store adds a
gatekeeper for nothing. `electron-updater` can take GitHub Releases as its
update source, so updates come from the same place.

**It stays free, and that is a constraint rather than a preference.** The
company seed list is [CC BY-NC-SA 4.0](https://github.com/pogopaule/awesome-sustainability-jobs)
— non-commercial. A free, open-source distribution is inside those terms, and
the constraint and the intent happen to point the same way.

**A tray process, with the browser as the view.** The pattern Ollama and Docker
Desktop use, and the honest answer to "it should keep working when I close the
window": the answer is process lifetime, not a different UI. The tray process
owns the server and supervises the workers; the browser tab renders and nothing
else, so closing it stops nothing. A single binary plus the browser first; an
Electron or Tauri tray shell after.

**What the supervisor has to do.**

- Restart a worker that died, and carry on across sleep and shutdown. Every
  worker is *already* resumable — a null-column queue, a sliced sweep, a
  cursored embedding backfill — which is what makes this a supervisor over
  existing code rather than a rewrite.
- A tray icon that says something: idle, scanning with a percentage, queue
  depth. Click it for the radar.
- OS notifications when a scan ends — "210 new, 3 strong". This is the only
  re-engagement surface a local app gets, and it should earn the interruption.
- Power sense: pause the heavy passes on battery, allow "judge overnight",
  default to running while plugged in and idle.
- A single-instance lock, port-conflict handling, and an opt-in to start with
  the session.

**Three judging tiers, chosen by the hardware it finds.**

1. A GPU that can hold the judge → a local model, with Ollama detected or
   installed (or `llama.cpp` embedded).
2. No such GPU → the existing bring-your-own-key cloud chain.
3. Neither → keyword and embedding only. The 0.6B embedder runs anywhere, and
   the [bake-off](ARCHITECTURE.md#adr-2--embedding-bake-off-with-pre-frozen-queries)
   measured that pairing as worth having on its own.

**One setup flow.** Drop in your CV, confirm the tracks it generates, scan.
Which is today's `npm install` → `cv:import` → `profile:generate` → `db:deploy`
→ `ingest` sequence, with the seams closed.

**Politeness, since the code would no longer be one person's.** Rate-sensitive
sources like LinkedIn default to off, and the limits stay conservative. Every
user comes from their own address, but they would all be running the same code,
and a shared codebase behaving badly is a different scale of problem to one
person behaving badly.

## Rescue lane

Mine the disqualified pool by embedding similarity, to catch gate mistakes
automatically. "High similarity to something the judge liked, but disqualified"
is exactly the shape of a scorer error, and the pool keeps every rejected
posting precisely so this is a query rather than a re-crawl
([ADR-1](ARCHITECTURE.md#adr-1--store-everything-flag-judgment-store-all)).

## Scheduled ingest and a digest

A schedule, and an email or notification summarising what a run found. Most of
the machinery exists; what is missing is the scheduler and the composition.

## A manual LinkedIn trigger

The connector exists and stays out of the automatic set on purpose — the guest
API is not something to hit on a timer. It comes back as a button you press,
with the per-source cooldown still guarding it.

## Open question: Postgres and a deployed build

Optional Postgres with pgvector, and a hosted deployment, have been on this list
for a while. They now sit awkwardly beside the two items above it: hosting is
the opposite of local-first, and a hosted service would need a fresh look at the
non-commercial seed licence. Recorded as undecided rather than quietly dropped.
