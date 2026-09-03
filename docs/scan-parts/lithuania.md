# Source scan: Lithuania

Scope: Lithuania only, tech roles, visa-sponsorship bias. Primary sources only —
every row below names a URL that was actually fetched. Where a fetch was
refused, the URL was retried from Node with a desktop-Chrome User-Agent before
the site was declared closed.

Already covered and therefore out of scope: eures, nofluffjobs, justjoin.it,
arbeitnow, remotive, remoteok, jobicy, himalayas, weworkremotely, freehire,
workingnomads, themuse, adzuna, jsearch/indeed, linkedin, plus the ~31 ATS
platforms that already have discovery adapters.

Scanned 2026-09-03.

## Headline

Lithuania is the weakest of the three Baltic states for machine access, and it
is worth stating plainly why: **every government-adjacent host tried in this
pass sits behind an active Cloudflare bot-challenge** (`uzt.lt`,
`migracija.lrv.lt`, `e-tar.lt`), and the one private-sector registry that
matters for the visa question — Startup Lithuania's official startup database
— is hosted on a separate domain (`unicorns.lt`) that **explicitly bans
ClaudeBot** in its `robots.txt`. Lithuania does run both a startup visa and a
shortage-occupation list, as the task expected, but neither was reachable as
structured data in this pass. Both of Lithuania's major private boards
(CVbankas.lt, CVonline.lt) are also closed — one by a custom anti-bot page, one
by the same Cloudflare ClaudeBot ban seen on CV.ee and CV.lv.

**Net result: zero new machine-readable sources for Lithuania this pass.**

## Findings

| Source | Type | Machine door? | Verified URL | Employer name published? | Visa relevance | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **Startup Lithuania's official startup database** (`unicorns.lt`, iframed into `startuplithuania.com/startup/`) | The startup-visa-adjacent register named in the task — Lithuania's "Startup Employee Visa" guide states plainly: *"a start-up that seeks to hire a highly qualified professional must also be registered in the official start-up database of Startup Lithuania"* | **No — explicit AI-crawler ban discovered mid-trace.** The page `https://www.startuplithuania.com/startup/` (200, 80,534 bytes) embeds the actual database via `<iframe src="https://unicorns.lt/en/startups">`. `unicorns.lt/robots.txt` (200) carries the same Cloudflare "Content-Signal" template as CV.ee/CV.lv/CVonline.lt: `User-agent: ClaudeBot` / `Disallow: /`. The iframe target had already been fetched once (200, 34,017 bytes) before the ban was found on a subsequent robots-first check of the same host; that response was discarded unread and no further requests were made to `unicorns.lt` | `https://www.startuplithuania.com/visaemployee/` (200, 86,234 bytes, quote source), `https://www.startuplithuania.com/startup/` (200, iframe source), `https://unicorns.lt/robots.txt` (200, AI-ban confirmed) | Not determined — ban respected | **This is the exact register the task asked about** | **skip — AI-crawler ban, respected.** The one register that would answer "how many Lithuanian startups can sponsor" is off-limits by the host's own declared policy |
| **Lithuania shortage-occupation list** ("trūkstamų profesijų sąrašas") | Ministry-maintained annual list of occupations with labour shortages, used in the new 2026 work-visa framework | **No — every candidate host is Cloudflare-challenged.** `https://migracija.lrv.lt/lt/naujienos/isplestas-trukstamu-profesiju-sarasas/` → **403**, full Cloudflare "Just a moment..." JS-challenge page (retried once with browser UA, same result). `https://www.migracija.lt/-/patvirtintas-naujas-tr%C5%ABkstam%C5%B3-profesij%C5%B3-s%C4%85ra%C5%A1as` → **200** but the page title is "Migris" and stripping `<script>`/`<style>` leaves 1,131 bytes — a client-rendered SPA shell with no server content. `https://www.e-tar.lt/portal/lt/legalAct/95cda490672011edbc04912defe897d1` (the Legal Acts Register, which would carry the underlying decree) → **403**, Cloudflare challenge again | `https://migracija.lrv.lt/lt/naujienos/isplestas-trukstamu-profesiju-sarasas/`, `https://www.migracija.lt/-/patvirtintas-naujas-tr%C5%ABkstam%C5%B3-profesij%C5%B3-s%C4%85ra%C5%A1as`, `https://www.e-tar.lt/portal/lt/legalAct/95cda490672011edbc04912defe897d1` | n/a — this is an occupation list, not an employer register, either way | Would inform *scoring* (does a title unlock the fast-track), not employer identity | **park — unreachable, all three hosts.** Secondary sources (search snippets) describe ~110 occupations for 2026 across construction/industry/services/agriculture, but this was never independently verified against a fetched page in this pass and is reported here only as context, not as a finding |
| **Užimtumo tarnyba** (`uzt.lt`) | Lithuania's national public employment service — the EURES upstream | **No — unreachable.** Both `https://uzt.lt/robots.txt` and the site root return HTTP **403** with a Cloudflare "Just a moment..." JS-challenge page (`cRay` header present, `cZone: 'migracija.lrv.lt'`-style challenge token structure). Retried once with a full desktop-Chrome UA and varied `Accept`/`Accept-Language` headers; identical result both times | `https://uzt.lt/robots.txt` | n/a — unreachable | Highest by intent | **park — Cloudflare-blocked, retried once as instructed, still closed** |
| **CVbankas.lt** | Lithuania's most-visited private job board | **No — unreachable via a custom anti-bot page.** `https://www.cvbankas.lt/robots.txt` and `https://en.cvbankas.lt/robots.txt` both return **403** with a branded (non-Cloudflare) HTML page titled "CVbankas.lt" and a `<meta http-equiv="refresh" content="360">`, on both the primary and English subdomain. Retried once with a full desktop-Chrome UA; same result | `https://www.cvbankas.lt/robots.txt`, `https://en.cvbankas.lt/robots.txt` | n/a — unreachable | Would be significant (site claims ~4,000 ads) | **park — unreachable, retried once as instructed** |
| **CVonline.lt** | Lithuania's other major private board (same corporate family as CV.ee/CV.lv) | **No — explicit AI-crawler ban.** `robots.txt` (200, 1,881 bytes), byte-for-byte the same Cloudflare "Content-Signal" template: `User-agent: ClaudeBot` / `Disallow: /` | `https://www.cvonline.lt/robots.txt` | Not checked — ban respected | Would be significant (site claims 3,000+ ads) | **skip — AI-crawler ban, respected.** No further pages fetched from this host |

## Checked, not worth it

- **`unicorns.lt/en/startups`** — fetched once (200, 34,017 bytes) before the
  host's `robots.txt` was checked and found to ban ClaudeBot. The content was
  discarded unread and is not reported here; no further requests were made to
  this host. This is recorded as a process note, not a finding.
- **`migracija.lrv.lt` / `e-tar.lt` / `uzt.lt`** — all three return Cloudflare
  JS-challenge pages (HTTP 403, `<title>Just a moment...</title>`) on every
  path tried, including `robots.txt` itself. This is a stronger block than a
  robots-file disallow — the server never serves un-challenged content to a
  non-browser client at all — and was treated the same way: retried once,
  then recorded as unreachable rather than routed around.

## Is anything better than what we already hold?

No new inventory this pass, and the reason is structural rather than
incidental: Lithuania's state-adjacent web infrastructure (the migration
department, the legal-acts register, the employment service) runs uniformly
behind Cloudflare's interactive challenge, and its two largest private boards
are either behind the same challenge template with an explicit ClaudeBot ban
(CVonline.lt, matching CV.ee/CV.lv) or a custom anti-bot wall (CVbankas.lt).
The one register that would have answered the task's central question for
Lithuania — Startup Lithuania's official startup database, required for the
Startup Employee Visa — turned out to live on `unicorns.lt`, which bans
ClaudeBot by name. That ban is the most load-bearing single fact in this file:
it is the reason Lithuania's startup-visa question is answered "closed door,
respected" rather than with a count.
