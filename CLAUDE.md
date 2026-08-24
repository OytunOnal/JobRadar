# JobRadar

Local-first job discovery engine and application tracker. Next.js + Prisma +
SQLite, a local LLM (Ollama) with a cloud fallback chain, and a background
worker that keeps the pool embedded and judged.

## Layout

`src/lib/` is grouped by concern: `queue/` (which postings, and the runner that
works them), `text/`, `scoring/`, `visa/`, `llm/`, `view/`, `user/` (profile and
settings), `location/`, plus `sources/` and `discovery/`. Only `db.ts`,
`ingest.ts`, `liveness.ts` and `domains.ts` sit at the root.

`scripts/` is grouped by **who runs it** — `pipeline/`, `backfill/`,
`discovery/`, `setup/`, `measure/`, `tools/`. See `scripts/README.md`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues at `OytunOnal/JobRadar`, driven by the `gh` CLI.
See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: the glossary is `CONTEXT.md` at the root, with architectural
decisions collected in `docs/ARCHITECTURE.md`.
See `docs/agents/domain.md`.
