import test from "node:test";
import assert from "node:assert/strict";
import { parseSections, postingView } from "../src/lib/sections";

const POSTING = `About us
Acme GmbH was founded in 2011 and we love ping pong.

Your tasks:
- Build Unity gameplay systems
- Own the render pipeline

What you bring:
- 5 years of C# experience
- Fluent German (C1)

Nice to have
- Console shipping experience

What we offer:
- Visa sponsorship and relocation support
- Free lunch

Equal Opportunity Employer
We consider all applicants without regard to race.`;

test("parseSections labels headings across a real posting shape", () => {
  const kinds = parseSections(POSTING).map((s) => s.kind);
  assert.deepEqual(kinds, [
    "company", "responsibilities", "requirements", "niceToHave", "benefits", "legal",
  ]);
});

test("parseSections handles German headings", () => {
  const de = "Deine Aufgaben:\n- Code schreiben\n\nDein Profil:\n- 3 Jahre Erfahrung";
  assert.deepEqual(parseSections(de).map((s) => s.kind), ["responsibilities", "requirements"]);
});

test("fit view drops company and benefits, keeps the role and its demands", () => {
  const v = postingView(POSTING, "fit");
  assert.doesNotMatch(v, /ping pong/);      // company blurb
  assert.doesNotMatch(v, /Free lunch/);     // benefits
  assert.doesNotMatch(v, /without regard/); // legal
  assert.match(v, /Unity gameplay/);
  assert.match(v, /5 years of C#/);
  assert.match(v, /Console shipping/);
});

test("facts view keeps benefits — sponsorship is advertised as a perk", () => {
  const v = postingView(POSTING, "facts");
  assert.match(v, /Visa sponsorship/);
  assert.match(v, /Fluent German/);
});

test("embed view describes the job, not the company or the perks", () => {
  const v = postingView(POSTING, "embed");
  assert.match(v, /Unity gameplay/);
  assert.match(v, /5 years of C#/);
  assert.doesNotMatch(v, /ping pong/);
  assert.doesNotMatch(v, /Free lunch/);
});

test("sections come back in document order, not priority order", () => {
  const v = postingView(POSTING, "fit");
  assert.ok(v.indexOf("Unity gameplay") < v.indexOf("5 years of C#"));
});

test("a posting with no headings degrades to the old head slice", () => {
  const flat = "We need a Unity developer. ".repeat(200);
  const v = postingView(flat, "fit");
  assert.ok(v.length > 3800 && v.length <= 4000, `filled the budget, got ${v.length}`);
  assert.match(v, /Unity developer/);
});

test("a bullet line is never mistaken for a heading", () => {
  const s = parseSections("- Requirements are flexible\n- Experience with Go");
  assert.equal(s.length, 1);
  assert.equal(s[0].kind, "intro");
});

test("budget truncates the lowest-priority section, not the payload", () => {
  const long = `Your tasks:\n${"Build systems. ".repeat(120)}\n\nAbout us:\n${"History. ".repeat(200)}`;
  const v = postingView(long, "embed");
  assert.match(v, /Build systems/);
  assert.doesNotMatch(v, /History/);
});

// Headings taken verbatim from the pool's unclassified bucket. Each one was a
// real miss at some point; the list is the regression net for the vocabulary.
// "What we're looking for" in particular hid behind a word-boundary bug for
// two rounds of tuning, so the corpus is checked, not eyeballed.
const CORPUS: Array<[string, string]> = [
  ["What we're looking for", "requirements"],
  ["What we’re looking for", "requirements"],   // curly apostrophe
  ["What you'll bring", "requirements"],
  ["What you have", "requirements"],
  ["You'll thrive in this role if you", "requirements"],
  ["We expect you to have", "requirements"],
  ["Key technologies", "requirements"],
  ["Education", "requirements"],
  ["In this role, you will", "responsibilities"],
  ["What you'll be doing", "responsibilities"],
  ["What you'll own", "responsibilities"],
  ["What success looks like", "responsibilities"],
  ["The day-to-day", "responsibilities"],
  ["Preferred", "niceToHave"],
  ["Bonus", "niceToHave"],
  ["It will be an added bonus if you have", "niceToHave"],
  ["What's in it for you", "benefits"],
  ["Ce que nous t'offrons", "benefits"],
  ["About Nebius", "company"],
  ["Who is Eleos Health?", "company"],
  ["The team", "company"],
  ["How we work", "company"],
  ["Important security notice for job applicants", "legal"],
  ["Notice to recruitment agencies and search firms", "legal"],
  ["When you're ready to start, simply click on the link below", "process"],
  ["Required", "requirements"],
  ["Must-haves", "requirements"],
  ["What we expect", "requirements"],
  ["Ideally you'd have", "requirements"],
  ["An ideal candidate should have", "requirements"],
  ["Your background looks something like this", "requirements"],
  ["Ce que tu apportes", "requirements"],
  ["Qualifikationen", "requirements"],
  ["Deine Skills", "requirements"],
  ["Kontaktinformationen", "process"],
  // Negatives: these tripped the requirements rules before narrowing them.
  ["What we have to offer", "benefits"],
  ["Time off", "benefits"],
  ["Culture at Ankar", "company"],
  ["Our values", "company"],
];

test("heading vocabulary: every heading harvested from the pool classifies", () => {
  const wrong = CORPUS
    .map(([h, want]) => [h, want, parseSections(`${h}:\n- x`)[0].kind] as const)
    .filter(([, want, got]) => want !== got);
  assert.deepEqual(wrong, [], `yanlış sınıflanan başlıklar: ${JSON.stringify(wrong)}`);
});

test("ALL-CAPS headings are read as headings, whatever the words", () => {
  // Shape taken from a live Ashby posting that filed its entire role
  // description under "ABOUT VOODOO": no colons, no bullets beneath, and a
  // bare "ROLE" no vocabulary knows. The fit view kept a 402-character skills
  // list out of 3,204 characters of posting until caps was treated as
  // structure.
  const posting = [
    "ABOUT ACME", "Founded in 2013, Acme makes mobile games.",
    "TEAM", "You will join a team of 5 engineers on the backend platform.",
    "ROLE", "You will work on services played by millions every day.",
    "PROFILE", "- 5 years of Go experience", "- Strong analytical skills",
  ].join("\n");
  const kinds = parseSections(posting).map((s) => `${s.kind}:${s.heading}`);
  assert.deepEqual(kinds, [
    "company:ABOUT ACME", "other:TEAM", "responsibilities:ROLE", "requirements:PROFILE",
  ]);
  const fit = postingView(posting, "fit");
  assert.match(fit, /played by millions/);   // the role survives
  assert.match(fit, /5 years of Go/);
  assert.doesNotMatch(fit, /Founded in 2013/); // the blurb still does not
});

test("a salary range is a value, not a heading", () => {
  const posting = "Base Salary Range:\n$112,000 — $187,000 USD\n\nRequirements:\n- Go";
  const headings = parseSections(posting).map((s) => s.heading);
  assert.ok(!headings.includes("$112,000 — $187,000 USD"), headings.join("|"));
});

test("starvation guard: a posting hiding its role in the company blurb still fills the window", () => {
  // Everything under one company heading, nothing else but a short list.
  const posting = `ABOUT ACME:\n${"We are a company that does things. ".repeat(60)}\n\nPROFILE:\n- Go`;
  const fit = postingView(posting, "fit");
  assert.ok(fit.length > 800, `starved at ${fit.length} chars`);
});

test("no starvation rescue when the posting is simply short", () => {
  const posting = "About us:\nWe love ping pong.\n\nRequirements:\n- Unity\n- C#";
  assert.doesNotMatch(postingView(posting, "fit"), /ping pong/);
});

test("empty-bodied headings are not printed", () => {
  const posting = "Role type:\n\nWork Authorization:\n\nRequirements:\n- Go";
  const v = postingView(posting, "fit");
  assert.doesNotMatch(v, /Work Authorization/);
  assert.match(v, /- Go/);
});
