# JobRadar

Local-first job discovery engine and application tracker. Next.js + Prisma +
SQLite, a local LLM (Ollama) with a cloud fallback chain, and a background
worker that keeps the pool embedded and judged.

## Agent skills

### Issue tracker

Issues live in GitHub Issues at `OytunOnal/JobRadar`, driven by the `gh` CLI.
See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root when it exists, with architectural
decisions currently collected in `docs/ARCHITECTURE.md`.
See `docs/agents/domain.md`.
