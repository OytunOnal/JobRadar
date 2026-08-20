import { test } from "node:test";
import assert from "node:assert/strict";
import { firstLink, parseComment } from "../src/lib/sources/hn";
import { mapJob as landingMap } from "../src/lib/sources/landingjobs";
import { mapJob as sdjMap } from "../src/lib/sources/swissdevjobs";
import { parseFeed as bsjParse } from "../src/lib/sources/berlinstartupjobs";
import { mapOffer, detailToText } from "../src/lib/sources/manfred";
import { parseFeed as neParse } from "../src/lib/sources/netempregos";

// ── HN Who is hiring ─────────────────────────────────────────────────────────

const HN_COMMENT = {
  id: 49156999,
  created_at: "2026-08-01T15:00:00.000Z",
  text:
    'Snout <a href="https:&#x2F;&#x2F;jobs.lever.co&#x2F;snout&#x2F;123" rel="nofollow">apply</a> | Senior Backend Engineer | Berlin or Remote (EU)<p>We build pet-care software. Visa sponsorship available. Stack: Go, Postgres, Kubernetes. Salary €90-110k.</p>',
};

test("HN parseComment: header segments -> company/title, ATS link wins, remote flag", () => {
  const job = parseComment(HN_COMMENT)!;
  assert.equal(job.source, "hn-whoishiring");
  assert.equal(job.company, "Snout apply"); // link text folds into segment 0; scoring is title-driven
  assert.ok(job.title.includes("Senior Backend Engineer"));
  assert.equal(job.url, "https://jobs.lever.co/snout/123"); // decoded, first non-HN link
  assert.equal(job.remote, true);
  assert.ok(job.description.includes("Visa sponsorship"));
  assert.equal(job.postedAt?.toISOString(), "2026-08-01T15:00:00.000Z");
});

test("HN parseComment: linkless comment falls back to the permalink; thin comments dropped", () => {
  const job = parseComment({ id: 7, created_at: "2026-08-02T00:00:00Z", text: "Acme GmbH | Unity Developer | Munich, Germany. On-site role, relocation help offered for the right candidate." })!;
  assert.equal(job.url, "https://news.ycombinator.com/item?id=7");
  assert.equal(job.company, "Acme GmbH");
  assert.equal(parseComment({ id: 8, text: "short" }), null);
});

test("HN firstLink skips HN-internal links", () => {
  assert.equal(firstLink('<a href="https:&#x2F;&#x2F;news.ycombinator.com&#x2F;item?id=1">x</a> <a href="https:&#x2F;&#x2F;acme.com&#x2F;jobs">y</a>'), "https://acme.com/jobs");
  assert.equal(firstLink("no links"), null);
});

// ── Landing.Jobs ─────────────────────────────────────────────────────────────

test("landing.jobs mapJob: company from URL path, relocation flag -> visa", () => {
  const job = landingMap({
    id: 19066,
    title: "Senior Java Software Developer",
    url: "https://landing.jobs/at/inscale/senior-java-developer-in-lisbon",
    locations: [{ city: "Lisbon", country_code: "pt" }],
    gross_salary_low: 40000,
    gross_salary_high: 55000,
    currency_code: "EUR",
    remote: false,
    relocation_paid: true,
    published_at: "2026-08-10T09:38:38.127Z",
    role_description: "<p>Build backend services.</p>",
    main_requirements: "<ul><li>Java</li></ul>",
  })!;
  assert.equal(job.company, "Inscale");
  assert.equal(job.location, "Lisbon, PT");
  assert.equal(job.salaryText, "40000–55000 EUR");
  assert.equal(job.visa, "yes");
  assert.ok(job.description.includes("Build backend services"));
  // relocation_paid false is "not offered", never a refusal:
  const noReloc = landingMap({ id: 2, title: "X", url: "https://landing.jobs/at/acme/x", relocation_paid: false })!;
  assert.equal(noReloc.visa, undefined);
  assert.equal(landingMap({ title: "no id/url" }), null);
});

// ── SwissDevJobs ─────────────────────────────────────────────────────────────

test("swissdevjobs mapJob: structured visa/workMode/salary, employer link wins", () => {
  const job = sdjMap({
    _id: "6989bd22",
    name: "Senior Software Engineer C++",
    company: "Cudos AG",
    actualCity: "Fahrweid",
    annualSalaryFrom: 100000,
    annualSalaryTo: 120000,
    expLevel: "Senior",
    jobType: "Full-Time",
    language: "German",
    workplace: "hybrid",
    hasVisaSponsorship: "Yes",
    technologies: ["C++", "Rust", "Embedded"],
    jobUrl: "Cudos-AG-Senior-Software-Engineer-C",
    redirectJobUrl: "https://jobs.dualoo.com/link/x/apply",
    isPaused: false,
    activeFrom: "2026-08-20T13:16:11.083+02:00",
  })!;
  assert.equal(job.visa, "yes");
  assert.equal(job.workMode, "hybrid");
  assert.equal(job.salaryText, "100000–120000 CHF");
  assert.equal(job.url, "https://jobs.dualoo.com/link/x/apply");
  assert.ok(job.description.includes("C++, Rust, Embedded"));
  // No redirect -> the board's own page; paused jobs dropped:
  const own = sdjMap({ _id: "a", name: "X", jobUrl: "slug", hasVisaSponsorship: "No" })!;
  assert.equal(own.url, "https://swissdevjobs.ch/jobs/slug");
  assert.equal(own.visa, "no");
  assert.equal(sdjMap({ _id: "b", name: "Y", jobUrl: "s", isPaused: true }), null);
});

// ── Berlin Startup Jobs ──────────────────────────────────────────────────────

test("BSJ parseFeed: 'Title // Company' convention, Berlin default location", () => {
  const xml = `<rss><channel><item>
    <title><![CDATA[Senior Backend Engineer // Acme GmbH]]></title>
    <link>https://berlinstartupjobs.com/engineering/senior-backend-acme/</link>
    <pubDate>Wed, 20 Aug 2026 08:00:00 +0000</pubDate>
    <description><![CDATA[<p>Build things in Berlin.</p>]]></description>
  </item></channel></rss>`;
  const jobs = bsjParse(xml);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "Senior Backend Engineer");
  assert.equal(jobs[0].company, "Acme GmbH");
  assert.equal(jobs[0].location, "Berlin, Germany");
  assert.equal(jobs[0].description, "Build things in Berlin.");
});

// ── Manfred ──────────────────────────────────────────────────────────────────

test("manfred mapOffer: remote percentage -> work mode, ACTIVE only", () => {
  const base = {
    id: 8457, position: ".NET Developer", slug: "gof-net-dev", status: "ACTIVE",
    salaryFrom: 30000, salaryTo: 35000, currency: "€", remotePercentage: 40,
    company: { name: "CENTRALIA" }, locations: ["Santander, Spain"],
    updatedAt: "2026-08-01T00:00:00Z",
  };
  const job = mapOffer(base)!;
  assert.equal(job.workMode, "hybrid");
  assert.equal(job.salaryText, "30000–35000 €");
  assert.equal(job.company, "CENTRALIA");
  assert.ok(job.url.includes("/job-offers/8457/gof-net-dev"));
  assert.equal(mapOffer({ ...base, remotePercentage: 100 })!.workMode, "remote");
  assert.equal(mapOffer({ ...base, status: "CLOSED" }), null);
});

test("manfred detailToText joins sections and stack", () => {
  const text = detailToText({
    introduction: "<p>Great team.</p>",
    whatWillYouDo: ["Ship features", "Review code"],
    techs: [{ name: "TypeScript" }, { name: "React" }],
  });
  assert.ok(text.includes("Great team."));
  assert.ok(text.includes("Ship features"));
  assert.ok(text.includes("Tech stack: TypeScript, React"));
});

// ── Net-Empregos ─────────────────────────────────────────────────────────────

test("netempregos parseFeed: IT category slice, Empresa/Zona extraction", () => {
  const xml = `<rss><item>
    <title><![CDATA[Programador Full Stack (M/F)]]></title>
    <link>https://www.net-empregos.com/15882900/programador-full-stack/</link>
    <pubDate>Thu, 20 Aug 2026 12:00:00 GMT</pubDate>
    <description><![CDATA[&lt;b&gt;Empresa: &lt;/b&gt;TechCo Lda&lt;br&gt;&lt;b&gt;Categoria: &lt;/b&gt;Informática ( Programação )&lt;br&gt;&lt;b&gt;Zona: &lt;/b&gt;Lisboa]]></description>
  </item><item>
    <title><![CDATA[Encarregado de Obra]]></title>
    <link>https://www.net-empregos.com/15882901/obra/</link>
    <description><![CDATA[&lt;b&gt;Categoria: &lt;/b&gt;Construção Civil]]></description>
  </item></rss>`;
  const jobs = neParse(xml);
  assert.equal(jobs.length, 1); // construction filtered out
  assert.equal(jobs[0].externalId, "15882900");
  assert.equal(jobs[0].company, "TechCo Lda");
  assert.equal(jobs[0].location, "Lisboa, Portugal");
});
