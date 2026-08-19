# JobRadar

[![CI](https://github.com/OytunOnal/JobRadar/actions/workflows/ci.yml/badge.svg)](https://github.com/OytunOnal/JobRadar/actions/workflows/ci.yml)

A personal job-discovery and application-tracking tool. JobRadar **discovers
tens of thousands of companies' official ATS boards**, pulls their listings
first-hand, scores each one against **your** CV with an LLM, and shows the
fresh, real matches on a dashboard — so you stop tab-hopping across job boards
and stop wading through SEO reposts, ghost postings, and years-old evergreen ads.

It runs locally, uses **your own** API keys (bring-your-own-key), and keeps your
CV and personal data on your machine (never committed).

![JobRadar dashboard — jobs ranked by LLM fit, with verdict gauges, filters, and per-job cover-letter drafts](docs/screenshot.png)

> Built as a personal tool + portfolio project. Not affiliated with any job board.

## What it does

- **Discovers companies at scale.** A platform-agnostic discovery layer knows 12
  ATS platforms (Greenhouse, Lever — US & EU, Ashby, SmartRecruiters, Workable,
  Recruitee, Personio, Workday, BambooHR, Breezy, Teamtailor, Join). It finds
  company boards three ways:
  - **harvest** — every aggregator job URL that flows through ingest is mined
    for the company's real ATS identity (direct match → redirect chain →
    landing-page HTML/embed scan);
  - **bulk crawl** — Common Crawl and Wayback Machine CDX sweeps over the
    platforms' domains (one run yields 60k+ board candidates);
  - **seeding** — your hand-curated company list validates like everything else,
    so stale or hijacked board tokens get caught instead of silently feeding you
    the wrong company's jobs.
  Candidates are **probe-validated** against each platform's API (dead boards
  rechecked monthly), and active boards feed ingest directly — with adaptive
  fetch frequency, so boards that never match your profile back off to monthly
  while relevant ones stay daily.
- **Aggregates** the classics too: remote boards (Arbeitnow, Remotive, RemoteOK,
  Jobicy, Himalayas, WeWorkRemotely) and — with free API keys — Adzuna and
  JSearch/Google-for-Jobs. Aggregators double as discovery sensors: even a junk
  listing can reveal a company's ATS, upgrading it to a first-party source.
- **Fights junk on every layer:**
  - SEO-farm domains are dropped outright; source trust (own ATS > curated
    boards > mass aggregators) breaks ranking ties;
  - **freshness** is derived from two signals — the source's claimed date *and*
    whether we still see the listing — so 2019-vintage evergreen postings and
    silently closed roles are hidden from the default view;
  - the LLM fit pass also flags **ghost postings** (talent-pool/mass-recruiting
    ads that aren't a real opening).
- **Deduplicates** the same role across sources — the direct-apply ATS listing
  always wins over the aggregator copy.
- **Scores** every job two ways: fast free keyword scoring (title-first, assigns
  a track), then LLM fit analysis against your CV — a 0-100 score, a
  `strong/possible/weak` verdict, a 2-3 sentence comment naming real strengths
  **and** gaps, and a reason category when it's weak (visa / language / profile).
- **Ranks** the board by real fit and lets you track each application
  (`new → interested → applied → interview → offer/rejected`).
- **Drafts** a per-job cover letter in your own voice.

## How it works

```
                         DISCOVERY                                INGEST
Common Crawl / Wayback ──▶ crawl ─┐                  curated companies ─┐
aggregator job URLs ─────▶ harvest ├─▶ AtsBoard ──▶ validate ──▶ active boards ├─▶ fetch
your companies.ts ───────▶ seed ──┘   (candidates)   (probe APIs)              │
                                                                  aggregators ─┘
                                                                       │
                              keyword score ── freshness & junk guards ─┤
                                                                       ▼
                                            store + dedupe ──▶ LLM fit (CV vs job)
                                                                       ▼
                                                          dashboard (fresh view)
```

The LLM layer is **multi-provider with automatic fallback** (Anthropic → Cerebras
→ Groq → Gemini → DeepSeek). Configure whichever you have; if one is rate-limited
the next takes over. Job descriptions are treated as untrusted input (prompt-
injection guarded) and trailing EEO/benefits boilerplate is trimmed before the
model sees them.

## Setup

Requires Node.js 20+.

```bash
npm install

# 1. Your API key(s) — bring your own. At least one LLM provider enables fit
#    scoring + cover letters. Without any, JobRadar falls back to keyword scoring.
cp .env.example .env         # then edit: add ANTHROPIC_API_KEY (and/or others)

# 2. Your profile — name, location. Kept private (gitignored).
cp config/user.example.ts config/user.ts   # then fill in your details

# 3. Your CV — hand it your resume and the radar aims itself:
npm run cv:import -- "path/to/Resume.pdf"   # .pdf, .txt, or .md
npm run profile:generate   # CV -> role families + scoring tracks (review the JSON it prints)

# 4. (optional) Fine-tune — add `targetRoles` (career changers) or explicit `tracks` and
#    `acceptRegions` overrides in config/user.ts (see the commented examples),
#    and edit src/lib/sources/companies.ts (companies to watch via their ATS).

# 5. Database (local SQLite)
npx prisma db push

# 6. (optional but recommended) Fill the company pool from the web archives —
#    takes ~15 min, finds tens of thousands of boards, then validate a slice:
npm run discovery:crawl
npm run discovery:validate -- 5000

# 7. Run
npm run ingest    # fetch + score jobs into the DB (also harvests new boards)
npm run dev       # dashboard at http://localhost:3000
```

Get a free/cheap API key from whichever provider you prefer:
[Anthropic](https://console.anthropic.com) · [Cerebras](https://cloud.cerebras.ai) ·
[Groq](https://console.groq.com). Fit scoring uses tiny prompts, so it costs cents.

## Commands

| Command | What it does |
|---|---|
| `npm run ingest` | Fetch jobs from every source (curated + discovered boards + aggregators), score, dedupe, store; harvest new ATS boards from aggregator URLs. Auto-fits the top matches if an LLM key is set. |
| `npm run discovery:crawl` | Bulk-discover company boards from Common Crawl + Wayback CDX (monthly job; flags: `--platform=`, `--source=`, `--snapshots=`). |
| `npm run discovery:validate` | Probe candidate boards → active/dead; extracts company names; 30-day rechecks. Optional cap: `-- 5000`. |
| `npm run discovery:audit` | Full-accounting check of the slug extractor against a URL corpus — any UNEXPLAINED line is a pattern gap. |
| `npm run cv:import` | Import your resume (`-- path.pdf`); becomes the CV context for scoring, letters, and profile generation. |
| `npm run profile:generate` | One LLM call: CV -> role families, granular scoring tracks (with a generic-title safety net), aggregator queries. Reviewed JSON, editable, never regenerates silently. |
| `npm run fit:batch` | LLM fit-score the **whole board** in one Anthropic batch (50% cheaper, async). Resume with `npm run fit:batch collect <id>`. |
| `npm run dev` | Start the dashboard. |
| `npm run db:studio` | Open Prisma Studio to inspect the DB. |
| `npm test` | Run the unit tests. |

On the dashboard: filter by track/fit/status/**age** (the default *fresh* view
hides evergreen, stale, and delisted postings), and per job hit **◎ Analyze fit**
(instant LLM scoring) or **✍ Draft letter**.

## Configuring for your search

- **`config/user.ts`** — your identity + CV, and (optionally) your own `tracks`
  and `acceptRegions` to fully retarget the radar — see the commented examples
  in `config/user.example.ts`. Track keys become the dashboard filter chips.
- **`src/lib/profile.ts`** — the default tracks/keywords and the shared
  disqualifier lists (non-engineering roles, noise filters).
- **`src/lib/sources/companies.ts`** — hand-picked companies to always watch via
  their ATS. The discovery layer finds the rest on its own.
- **`src/lib/discovery/platforms.ts`** — the ATS platform registry. Adding a
  platform is data, not code: URL patterns, a probe endpoint, and (optionally) a
  fetcher. Every entry documents its live-verified quirks (case-sensitive APIs,
  regional namespaces, POST-only probes, redirect traps).

## Tech

Next.js (App Router) · Prisma + SQLite · TypeScript · multi-provider LLM layer ·
Anthropic Message Batches · Common Crawl / Wayback CDX. No framework lock-in on
the sources — each is one small file returning a normalized job shape; ~100 unit
tests grounded in real corpus data.

## Roadmap

- LLM semantic dedup (catching the same role reposted with a new id).
- Fetchers for the parked platforms (BambooHR, Breezy, Teamtailor, Join).
- Salary parsing to filter out low bands.
- Scheduled ingest + digest notifications.
- Optional Postgres/Supabase + deploy.

## License

MIT — see [LICENSE](./LICENSE).
