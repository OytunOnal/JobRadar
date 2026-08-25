# Setup and operation

The [README](../README.md) has the five commands that get you a working radar.
This is everything else: what each step actually does, how to keep it running,
what to change when the results are not what you wanted, and how to upgrade
without losing the part you cannot get back.

- [Requirements](#requirements)
- [First run, step by step](#first-run-step-by-step)
- [Configuring for your search](#configuring-for-your-search)
- [The commands you will use](#the-commands-you-will-use)
- [Upgrading](#upgrading)

## Requirements

**Node.js 20 or newer.** Nothing else is mandatory.

For local judging, [Ollama](https://ollama.com) with a model your machine can
actually hold — the judge is a 27B, which wants roughly 18 GB of VRAM. If that
is not your hardware, set any cloud provider key instead and the same interface
uses it. With neither, keyword scoring and the local 0.6B embedding still run,
and the [bake-off](ARCHITECTURE.md#adr-2--embedding-bake-off-with-pre-frozen-queries)
says that combination is worth having on its own.

Most sources need no key at all. The three that do — Adzuna, JSearch, Indeed via
Apify — skip themselves when their key is absent, and the run does not care.

## First run, step by step

```bash
npm install
```

`postinstall` seeds `config/user.ts` from the example, so a clean checkout
builds without any manual step.

**1 — Keys, all optional.**

```bash
cp .env.example .env
```

Any LLM provider key, or a local Ollama model, is what turns on fit scoring and
cover-letter drafting. Everything else works without one.

**2 — Who you are.**

```bash
cp config/user.example.ts config/user.ts
```

Gitignored. Your name and location, plus optional overrides for tracks and
regions if you would rather not use the generated profile.

**3 — Your CV.**

```bash
npm run cv:import -- "path/to/Resume.pdf"    # .pdf, .txt or .md
npm run profile:generate
```

`cv:import` extracts the text to `config/cv.txt`; `profile:generate` reads it
and writes `config/profile.generated.json` — your tracks, their keywords, the
seniority you want and the seniority you do not, your working languages, and
the search queries the aggregators will use.

Both files stay on your machine and are gitignored. The generated profile is
**reviewed JSON**: read it, edit it, and it will never regenerate behind your
back — the app tells you when your CV has changed and leaves the decision to
you.

**4 — Database.**

```bash
npm run db:deploy
```

A local SQLite file. Run it again after every `git pull` — see
[Upgrading](#upgrading).

**5 — Fill the company pool.** Recommended, about fifteen minutes.

```bash
npm run discovery:crawl
npm run discovery:validate -- 5000
```

`crawl` mines ATS board tokens out of Common Crawl and Wayback CDX indexes;
`validate` probes each candidate against its platform's own API and keeps the
ones that answer. Without this you still get the curated companies and the
aggregators — you just do not get the fifty thousand company boards.

**6 — Run it.**

```bash
npm run ingest           # fetch + score into the database
npm run dev              # the radar at http://localhost:3000
```

**7 — Keep it judged.** Optional but this is where the fit scores come from.

```bash
npm run worker
```

Ctrl-C whenever you like; every lane resumes from what the database already
has. See [the worker](../README.md#the-worker).

## Configuring for your search

Every personal preference lives in your profile, not in code. The
[profile page](http://localhost:3000/profile) edits all of it while the app is
running, and tells you what each change costs — how many postings it just made
stale, and offering to repair them.

By hand, if you prefer:

| File | What it is |
|---|---|
| `config/settings.json` | What the profile page writes. Hand-editable, exportable, sent nowhere. |
| `config/profile.generated.json` | The CV-generated profile. Gitignored, never regenerated silently. |
| `config/user.ts` | Identity, and developer overrides that outrank the generated profile. |
| `config/cv.txt` | Your CV as text. Only three things read it: the judge, the embedding, and the profile generator. |
| `src/lib/sources/companies.ts` | Companies to always watch, whatever discovery finds. |
| `src/lib/discovery/platforms.ts` | The ATS registry. Adding a platform is data, not code. |

The pipeline is persona-independent by design: a junior data analyst and a staff
game developer run the same code with different profiles
([ADR-6](ARCHITECTURE.md#adr-6--persona-independence-detection-is-universal-judgment-is-profile)).

## The commands you will use

**The pipeline**

| Command | What it does |
|---|---|
| `npm run ingest` | Fetch every source in parallel, score, dedupe, store all of it; harvest new ATS boards from the aggregator URLs it saw. |
| `npm run ingest -- --only <name>` | Just these sources. A platform name takes its discovered boards too — stalest first, so repeating the command walks the platform. |
| `npm run ingest -- --boards N` | How many discovered boards one run may take. Default 200. |
| `npm run sweep` | Every due board in the pool, sliced, RAM-aware and resumable. Hours, not minutes. |
| `npm run worker` | The background worker: holds the GPU, runs embed → judge in chunks, visa-marked postings first. |

**Discovery**

| Command | What it does |
|---|---|
| `npm run discovery:crawl` | Mine board tokens from Common Crawl and Wayback CDX. |
| `npm run discovery:validate -- N` | Probe N candidates against their platform's API; keep what answers. |
| `npm run discovery:hf` | Seed candidates from public company datasets. |
| `npm run discovery:audit` | Audit the extractor against its recorded corpus. |

**Your profile**

| Command | What it does |
|---|---|
| `npm run cv:import -- "path"` | Resume (.pdf/.txt/.md) → `config/cv.txt`. |
| `npm run profile:generate` | CV → tracks, seniority bands, languages, search queries. |

**Backfills** — each one resumable, each one safe to kill.

| Command | What it does |
|---|---|
| `npm run rescore` | Re-score only the rows not yet scored by the current `SCORER_VERSION`. |
| `npm run fit:fill` | The judge, working the blended queue — visa tier first. |
| `npm run embed:fill` | Local embeddings for the blended queue. |
| `npm run facts:fill` | Extract what postings state about themselves, independent of any CV. |
| `npm run desc:fill` | Fetch bodies for platforms whose list API carries none. |
| `npm run visa:retier` | Recompute visa tiers after a profile or register change. |
| `npm run locations:fill` | Resolve location strings the gazetteer could not place. |
| `npm run repair:descriptions` | Re-convert postings stored before the HTML-to-text fix. |

**Maintenance**

| Command | What it does |
|---|---|
| `npm run sponsors` | Refresh the public visa-sponsor registers (NL / UK / DK / IE). |
| `npm run doctor` | Health-check every source connector and report what is broken. |
| `npm test` | The unit tests, grounded in real corpus data. |
| `npm run db:studio` | Prisma Studio against your local database. |

Not every script is here — the measurement and diagnosis ones
(`measure:sections`, `tune:fitwindow`, `fit:review` and friends) exist to answer
a question once rather than to be run on a schedule.
[`scripts/README.md`](../scripts/README.md) has all of them, grouped by who runs
them.

## Upgrading

```bash
git pull
npm install
npm run db:deploy
```

Your database is the part you cannot get back. Every judgment in it is about a
minute of GPU that re-running nothing reproduces, and alongside them sit your
applications, your notes and your dismissals — which are also the most useful
labelled data the system has
([ADR-5](ARCHITECTURE.md#adr-5--dismissal-reasons-as-labeled-training-data)).

So schema changes ship as **migrations**: ordered, recorded, and applied without
touching your rows. `db:deploy` is the only command you need after a pull.

<details>
<summary><b>If you used this before migrations existed, run these two once</b></summary>

```bash
npx prisma db push                            # bring the database to the current shape
npx prisma migrate resolve --applied 0_init   # record that shape as the baseline
```

Both, and in that order.

`migrate resolve` only *records* a migration as applied — it does not run it. On
its own it would tell a database created by the old `db push` that it already
has columns it has never had, and every query touching them would fail. The push
adds the columns first; the resolve then routes every later change through
migrations.

Everything after that is `npm run db:deploy`.

</details>
