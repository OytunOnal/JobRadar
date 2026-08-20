import { test } from "node:test";
import assert from "node:assert/strict";
import { firstLink, parseComment } from "../src/lib/sources/hn";
import { mapJob as landingMap } from "../src/lib/sources/landingjobs";
import { mapJob as sdjMap } from "../src/lib/sources/swissdevjobs";

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
