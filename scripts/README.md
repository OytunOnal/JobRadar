# scripts/

Grouped by **who runs it**, because that was the question the flat directory
could not answer. Thirty-five files sat here with no way to tell a nightly
worker from a migration that had already run once in 2026.

Most of what follows has an `npm run` entry. Five do not — `embed-eval` in
`measure/` and all four in `tools/` — and those you invoke directly:
`npx tsx scripts/<dir>/<name>.ts`. The two files in the root, `init-config.mjs`
(postinstall) and `chain-embed-then-fit.ps1`, are called by something other
than you.

## `pipeline/` — the regular passes

The ones you or a schedule actually start.

| script | `npm run` | what it does |
|---|---|---|
| `ingest.ts` | `ingest` | one fetch across every source, scored and stored |
| `worker.ts` | `worker` | keeps the pool embedded and judged between ingests; **spawns** the backfills |
| `board-sweep.ts` | `sweep` | the whole discovered board pool, sliced and resumable |
| `sponsors-refresh.ts` | `sponsors` | refresh the public visa-sponsor registers |

## `backfill/` — fill in what is missing or behind

Eight of these run inside `backfill()` (`src/lib/queue/backfill.ts`), which owns
the budget, the log, the GPU lock, the fail-streak and the run receipt in
`.run/<script>.json`. Those eight are safe to interrupt and each resumes from
what the database already holds:

`desc-fill` · `embed-fill` · `fit-fill` · `facts-fill` · `rescore` ·
`repair-descriptions` · `fit-review` · `fit-rereview`

Three are not converted yet, so they have no budget flag, no fail-streak and
leave no receipt: `fit-batch` · `locations-fill` · `visa-retier`. They still
resume — their queues consume themselves — but interrupting one leaves no
record of where it stopped.

The worker spawns two of them (`embed-fill`, `fit-fill`) and reads their
receipts; the rest you run yourself.

## `discovery/` — find boards that exist

Separate from ingest, which fetches postings from boards already known.

`discover-crawl` · `discover-hf` · `discover-validate` · `discovery-audit`

## `setup/` — first run

`cv-import` (resume → CV context) · `profile-generate` (CV → scoring profile).

## `measure/` — read, never write

Diagnostics and tuning. None of these change a row, so any of them is safe to
run against the live pool while the worker is working.

`doctor` (source health + the visa-tier drift audit) · `audit-sections` ·
`measure-sections` · `diagnose-sections` · `diagnose-requirements` ·
`tune-fit-window` · `embed-eval` (the embedding bake-off behind ADR-2).

## `tools/` — occasional, by hand

Re-runnable importers and one manual utility. They are not part of any cadence;
you run them when there is a reason.

`seed-vc` · `import-openjobsdata` · `import-sustainability` · `harvest-urls`

## Deleted rather than filed

`migrate-layered.ts` and `backfill-fit-version.ts` were migrations that had
already done their work — the layered schema split, and stamping old verdicts
with a prompt version. Keeping a spent migration means answering "should I run
this?" every time someone reads the directory. They are in the git history.
