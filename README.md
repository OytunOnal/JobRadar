# JobRadar

[![CI](https://github.com/OytunOnal/JobRadar/actions/workflows/ci.yml/badge.svg)](https://github.com/OytunOnal/JobRadar/actions/workflows/ci.yml)

A personal job-discovery and application-tracking tool. JobRadar pulls listings
from many sources, scores each one against **your** CV with an LLM, and shows the
best matches on a dashboard — so you stop tab-hopping across a dozen job boards
and only look at roles that actually fit you.

It runs locally, uses **your own** API keys (bring-your-own-key), and keeps your
CV and personal data on your machine (never committed).

> Built as a personal tool + portfolio project. Not affiliated with any job board.

## What it does

- **Aggregates** jobs from remote boards (Arbeitnow, Remotive, RemoteOK, Jobicy,
  Himalayas, WeWorkRemotely) **and directly from company ATS boards** (Greenhouse,
  Lever, Ashby, SmartRecruiters) for a curated list of companies you care about.
- **Deduplicates** the same role coming in from multiple sources.
- **Scores** every job two ways:
  1. Fast, free keyword scoring (title-first) that assigns a track and filters noise.
  2. LLM fit analysis against your CV — a 0-100 score, a `strong/possible/weak`
     verdict, and a 2-3 sentence comment naming the real strengths **and** gaps.
- **Ranks** the board by real fit and lets you track each application
  (`new → interested → applied → interview → offer/rejected`).
- **Drafts** a per-job cover letter in your own voice.

## How scoring works

```
sources ──▶ keyword score (free, title-first) ──▶ store + dedupe
                                                      │
                                          LLM fit (your CV vs the job)
                                          ├─ per-job button (instant)
                                          └─ batch: whole board at once (50% cheaper)
```

The LLM layer is **multi-provider with automatic fallback** (Anthropic → Cerebras
→ Groq → Gemini → DeepSeek). Configure whichever you have; if one is rate-limited
the next takes over.

## Setup

Requires Node.js 20+.

```bash
npm install

# 1. Your API key(s) — bring your own. At least one LLM provider enables fit
#    scoring + cover letters. Without any, JobRadar falls back to keyword scoring.
cp .env.example .env         # then edit: add ANTHROPIC_API_KEY (and/or others)

# 2. Your profile — name, location, CV. Kept private (gitignored).
cp config/user.example.ts config/user.ts   # then fill in your details

# 3. (optional) Retarget the search to your field — edit src/lib/profile.ts
#    (tracks, keywords, accepted regions) and src/lib/sources/companies.ts
#    (companies to watch via their ATS).

# 4. Database (local SQLite)
npx prisma db push

# 5. Run
npm run ingest    # fetch + keyword-score jobs into the DB
npm run dev       # dashboard at http://localhost:3000
```

Get a free/cheap API key from whichever provider you prefer:
[Anthropic](https://console.anthropic.com) · [Cerebras](https://cloud.cerebras.ai) ·
[Groq](https://console.groq.com). Fit scoring uses tiny prompts, so it costs cents.

## Commands

| Command | What it does |
|---|---|
| `npm run ingest` | Fetch jobs from all sources, keyword-score, dedupe, store. Auto-fits the top matches if an LLM key is set. |
| `npm run fit:batch` | LLM fit-score the **whole board** in one Anthropic batch (50% cheaper, async). Resume with `npm run fit:batch collect <id>`. |
| `npm run dev` | Start the dashboard. |
| `npm run db:studio` | Open Prisma Studio to inspect the DB. |
| `npm test` | Run the unit tests (scoring + LLM-output parsing). |

On the dashboard: filter by track/status, sort by fit, and per job hit
**◎ Analyze fit** (instant LLM scoring) or **✍ Draft letter**.

## Configuring for your search

- **`src/lib/profile.ts`** — tracks, title/body keywords, accepted regions,
  and the disqualifier lists. This is where you retarget the radar.
- **`src/lib/sources/companies.ts`** — the companies to pull directly from their
  ATS. Add a line per company (find its Greenhouse/Lever/Ashby/SmartRecruiters
  board token).
- **`config/user.ts`** — your identity + CV (gitignored).

## Tech

Next.js (App Router) · Prisma + SQLite · TypeScript · multi-provider LLM layer ·
Anthropic Message Batches. No framework lock-in on the sources — each is one small
file returning a normalized job shape.

## Roadmap

- More job sources (aggregator APIs that index LinkedIn/Indeed/Glassdoor via
  Google-for-Jobs; game-specific boards).
- Salary parsing to filter out low bands.
- Scheduled ingest + digest notifications.
- Optional Postgres/Supabase + deploy.

## License

MIT — see [LICENSE](./LICENSE).
