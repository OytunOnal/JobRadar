import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// THE ONLY TEST IN THIS REPO THAT RUNS A WRITE PATH.
//
// Everything else here is a pure-function test, and that gap is not academic: a
// census found the derived fields written by hand in four places, drifted apart
// in six ways, and NOTHING would have caught any of it. The nearest existing
// test re-derives the kept-text rule inside the test file — delete the real line
// in ingest.ts and it still passes.
//
// So this one talks to a real database. A temp SQLite file, `prisma db push`,
// and then the two paths that matter: a first sighting, and a title-only
// re-sighting of a posting whose body a detail fetch had enriched. That second
// case is the one that has broken repeatedly.

const dir = mkdtempSync(join(tmpdir(), "jr-store-"));
const dbPath = join(dir, "test.db").replace(/\\/g, "/");
process.env.DATABASE_URL = `file:${dbPath}`;

execSync("npx prisma db push --skip-generate --accept-data-loss", {
  env: process.env,
  stdio: "pipe",
});

// Dynamic, so the env above is set before db.ts constructs its client.
const { prisma } = await import("../src/lib/db");
const { storeSighting } = await import("../src/lib/ingest");
const { statedFields, derivedFields } = await import("../src/lib/derive");

const ENRICHED = [
  "About the role",
  "We are hiring a Unity developer for our games team.",
  "Requirements",
  "- 5+ years of professional Unity and C#",
  "- Shader and rendering pipeline experience",
  "We offer visa sponsorship and relocation support.",
].join("\n");

function sighting(over: Record<string, unknown> = {}) {
  return {
    source: "gh:acme", externalId: "42",
    url: "https://boards.greenhouse.io/acme/jobs/42?utm_source=feed",
    title: "Senior Unity Developer", company: "Acme GmbH",
    location: "Berlin, Germany", remote: false,
    description: ENRICHED,
    postedAt: new Date("2026-06-01T00:00:00Z"),
    ...over,
  } as never;
}

// Each test gets its own posting identity: these run against one database, and
// a shared row would make one test's writes another's starting state.
async function store(job: never, id: string) {
  const j = job as unknown as { source: string; externalId: string; description: string };
  const ctx = {
    key: `k-${id}`,
    ck: `ck-${id}`,
    country: "de" as string | null,
    sponsorReg: false,
    identity: {},
  };
  ctx.identity = {
    dedupeKey: ctx.key, contentKey: ctx.ck,
    source: j.source, externalId: j.externalId, country: ctx.country,
    ...statedFields(job),
    ...derivedFields(job, { country: ctx.country, sponsorReg: ctx.sponsorReg }),
    postedAt: (job as unknown as { postedAt?: Date }).postedAt ?? null,
  };
  return storeSighting(job, ctx);
}

test("a first sighting stores the posting, its text and its score history", async () => {
  const out = await store(sighting(), "first");
  assert.equal(out.kind, "created");

  const row = await prisma.job.findUnique({
    where: { id: out.id },
    include: { content: true, scores: true, listings: true },
  });
  assert.ok(row);
  assert.equal(row!.title, "Senior Unity Developer");
  assert.equal(row!.url.includes("utm_source"), false, "tracking params stripped");
  assert.equal(row!.content?.description, ENRICHED);
  assert.ok(row!.score > 0, "an enriched Unity posting scores");
  assert.equal(row!.disqualified, false);

  // Neither ingest path used to append this, which is why the rescore queue
  // permanently reported work ingest had just done.
  assert.equal(row!.scores.length, 1, "the scorer's decision is recorded");
  assert.equal(row!.scores[0].score, row!.score, "history and projection agree");
  assert.equal(row!.listings.length, 1);
  assert.equal(row!.listings[0].event, "listed");
});

test("a title-only re-sighting keeps the enriched body and the score it earned", async () => {
  const first = await store(sighting(), "kept");
  const before = await prisma.job.findUnique({ where: { id: first.id }, include: { content: true } });

  // The sweep comes back with a list payload carrying no body — the case that
  // used to collapse the score to a title-only reading on every sweep.
  const again = await store(sighting({ description: "Senior Unity Developer" }), "kept");
  assert.equal(again.kind, "updated");
  assert.equal(again.id, first.id, "the same row, not a second one");

  const after = await prisma.job.findUnique({
    where: { id: first.id },
    include: { content: true, scores: true },
  });
  assert.equal(after!.content?.description, ENRICHED, "the fuller body is kept");
  assert.equal(after!.score, before!.score, "and so is the score that body earned");
  assert.equal(after!.visa, "yes", "and the sponsorship its text states");
  assert.equal(after!.scores.length, 2, "each scoring decision is appended");
});

test("a re-sighting refreshes what the source states, but never the date", async () => {
  const first = await store(sighting(), "stated");
  const before = await prisma.job.findUnique({ where: { id: first.id } });

  await store(sighting({
    title: "Staff Unity Developer",
    company: "Acme International GmbH",
    location: "Munich, Germany",
    url: "https://boards.greenhouse.io/acme/jobs/42-renamed",
    postedAt: new Date("2026-08-24T00:00:00Z"),
  }), "stated");

  const after = await prisma.job.findUnique({ where: { id: first.id } });
  assert.equal(after!.title, "Staff Unity Developer", "a retitled posting is retitled");
  assert.equal(after!.company, "Acme International GmbH");
  assert.equal(after!.location, "Munich, Germany");
  assert.ok(after!.url.endsWith("42-renamed"));
  // The one stated field deliberately left alone: a source re-stamping an
  // evergreen ad as "posted today" would launder a dead posting into a fresh one.
  assert.deepEqual(after!.postedAt, before!.postedAt, "postedAt is never refreshed");
});

test("a re-sighting does not clobber the user's pipeline status", async () => {
  const first = await store(sighting(), "status");
  await prisma.job.update({ where: { id: first.id }, data: { status: "applied", note: "sent CV" } });

  await store(sighting({ description: "Senior Unity Developer" }), "status");

  const after = await prisma.job.findUnique({ where: { id: first.id } });
  assert.equal(after!.status, "applied");
  assert.equal(after!.note, "sent CV");
});

test("an llm seniority verdict survives a re-sighting", async () => {
  const first = await store(sighting(), "seniority");
  await prisma.job.update({
    where: { id: first.id },
    data: { seniorityLevel: "staff", seniorityBy: "llm" },
  });

  await store(sighting(), "seniority");

  const after = await prisma.job.findUnique({ where: { id: first.id } });
  assert.equal(after!.seniorityLevel, "staff", "the detector must not demote the model");
  assert.equal(after!.seniorityBy, "llm");
});

test.after(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
