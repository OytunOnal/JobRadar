import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  radarFilters, radarWhere, radarFacetWhere, radarPaging, countryChips,
  allowedCountries, PAGE_SIZE,
} from "../src/lib/view/radar";
import { profile } from "../src/lib/user/profile";

// The radar's query was 181 lines inside a page component, built by mutating
// two `any` locals. Nothing could call it, so nothing could test it — and it
// carried an OR arm that was correct in shape and impossible to match for
// months. The pure half of these tests pins the shape; the database half at the
// bottom pins what the shape actually SELECTS, which is the half that would
// have caught that arm.

const TRACKS = profile.tracks.map((t) => t.key);
const f = (sp: Record<string, string | undefined>) => radarFilters(sp, TRACKS);

test("the URL is untrusted: unknown values never reach Prisma", () => {
  const got = f({ track: "not-a-track,also-fake", verdict: "excellent", visa: "sideways", loc: "teleport" });
  assert.deepEqual(got.tracks, []);
  assert.equal(got.verdict, "all", "an invented verdict falls back, it does not filter");
  assert.deepEqual(got.visaTiers, []);
  assert.deepEqual(got.workModes, []);
});

test("known values survive, whitespace and blanks do not", () => {
  const track = TRACKS[0];
  const got = f({ track: ` ${track} , , `, verdict: "strong", loc: "remote,hybrid", visa: "yes,no", q: "  unity  ", page: "3" });
  assert.deepEqual(got.tracks, [track]);
  assert.equal(got.verdict, "strong");
  assert.deepEqual(got.workModes, ["remote", "hybrid"]);
  assert.deepEqual(got.visaTiers, ["yes", "no"]);
  assert.equal(got.q, "unity");
  assert.equal(got.page, 3);
});

test("a nonsense page number lands on page one, never on page zero", () => {
  assert.equal(f({ page: "0" }).page, 1);
  assert.equal(f({ page: "-4" }).page, 1);
  assert.equal(f({ page: "banana" }).page, 1);
  assert.deepEqual(radarPaging(f({ page: "2" })), { skip: PAGE_SIZE, take: PAGE_SIZE });
});

test("the radar asks only for discoverable postings", () => {
  const w = JSON.stringify(radarFacetWhere(f({})));
  assert.ok(w.includes('"disqualified":false'));
  assert.ok(w.includes('"delistedAt":null'));
  assert.ok(w.includes('"duplicateOfId":null'));
  assert.ok(w.includes('"new"'));
});

test("age is disclosed, not filtered: no postedAt clause reaches the query", () => {
  // The age filter was measured hiding 74 already-judged postings, 16 of them
  // strong. It is a label now (see labels.test.ts), not a where clause.
  const w = JSON.stringify(radarWhere(f({}), { poolNewest: new Date(), top: [], other: [] }));
  assert.equal(w.includes("postedAt"), false);
});

test("absence IS filtered, against the pool's clock", () => {
  const withClock = JSON.stringify(radarFacetWhere(f({}), new Date("2026-08-24T00:00:00Z")));
  assert.ok(withClock.includes("lastSeenAt"), "a direct source that stopped listing drops out");
  // Without a pool reading there is nothing to measure against, so nothing is
  // dropped — better than retiring the pool because ingest paused.
  assert.equal(JSON.stringify(radarFacetWhere(f({}), null)).includes("lastSeenAt"), false);
});

test("a country in the URL that has no chip is dropped, not queried", () => {
  // Otherwise a stale bookmark filters the radar down to a chip the user cannot
  // see in order to unset it.
  const withGhostChip = radarWhere(f({ country: "zz" }), { poolNewest: null, top: ["de"], other: [] });
  assert.equal(JSON.stringify(withGhostChip).includes("zz"), false);
});

test("the three pseudo-countries mean what they say", () => {
  const w = JSON.stringify(radarWhere(f({ country: "remote,unknown,other" }), {
    poolNewest: null, top: [], other: ["pt", "ie"],
  }));
  assert.ok(w.includes('"workMode":"remote"'), "remote = no country, works anywhere");
  assert.ok(w.includes('"not":"remote"'), "unknown = no country and not remote");
  assert.ok(w.includes('"pt"'), "other = the long tail behind the top ten");
});

test("chips are the ten biggest, and the rest fold into other", () => {
  const counts = new Map(Object.entries({
    de: 90, nl: 80, gb: 70, fr: 60, es: 50, pl: 40, se: 30, dk: 20, ie: 10, pt: 9, at: 8, be: 7,
  }));
  const { top, other, otherCount } = countryChips(f({}), counts);
  assert.equal(top.length, 10);
  assert.equal(top[0], "de");
  assert.equal(other.includes("at"), true);
  assert.equal(other.includes("de"), false);
  assert.equal(otherCount, 15, "8 + 7, and every zero-count country adds nothing");
});

test("selecting a region narrows the countries a chip can come from", () => {
  const all = allowedCountries(f({}));
  const nordics = allowedCountries(f({ region: "nordics" }));
  assert.ok(nordics.length > 0 && nordics.length < all.length);
});

// ── The half that asks the database ───────────────────────────────────────

const dir = mkdtempSync(join(tmpdir(), "jr-radar-"));
process.env.DATABASE_URL = `file:${join(dir, "test.db").replace(/\\/g, "/")}`;
execSync("npx prisma db push --skip-generate --accept-data-loss", { env: process.env, stdio: "pipe" });
const { prisma } = await import("../src/lib/db");

let seq = 0;
async function seed(over: Record<string, unknown> = {}) {
  seq++;
  return prisma.job.create({
    data: {
      dedupeKey: `k${seq}`, contentKey: `c${seq}`, source: "gh:acme", externalId: `${seq}`,
      url: `https://x.co/${seq}`, title: "Unity Developer", company: "Acme",
      country: "de", score: 70, status: "new", lastSeenAt: new Date("2026-08-24T00:00:00Z"),
      ...over,
    },
  });
}

const ids = async (w: object) =>
  (await prisma.job.findMany({ where: w as never, select: { id: true } })).map((r) => r.id);

test("a discoverable posting is returned; the three exclusions are not", async () => {
  const shown = await seed();
  const gone = await seed({ delistedAt: new Date() });
  const gated = await seed({ disqualified: true });
  const dupe = await seed({ duplicateOfId: shown.id });
  const starred = await seed({ status: "interested" });

  const got = await ids(radarWhere(f({}), { poolNewest: null, top: [], other: [] }));
  assert.ok(got.includes(shown.id));
  for (const [name, row] of [["delisted", gone], ["disqualified", gated], ["duplicate", dupe], ["starred", starred]] as const) {
    assert.equal(got.includes(row.id), false, `a ${name} posting must not reach the radar`);
  }
});

test("a posting you applied to is NOT re-admitted by any arm", async () => {
  // The dead branch that prompted this: an OR arm re-admitting pursued postings
  // sat in the query for months, unreachable because the population pinned
  // status and the two met in one AND. Shape-correct, result-impossible — only
  // a query against real rows can tell the difference.
  const applied = await seed({ status: "applied" });
  const got = await ids(radarWhere(f({}), { poolNewest: null, top: [], other: [] }));
  assert.equal(got.includes(applied.id), false);
});

test("an old posting is still returned — age is a label, not a filter", async () => {
  const ancient = await seed({
    postedAt: new Date("2019-01-01T00:00:00Z"),
    firstSeenAt: new Date("2019-01-01T00:00:00Z"),
  });
  const got = await ids(radarWhere(f({}), { poolNewest: new Date("2026-08-24T00:00:00Z"), top: [], other: [] }));
  assert.ok(got.includes(ancient.id), "ADR-9: disclose the risk, keep the posting");
});

test("a direct source that stopped listing drops out against the pool clock", async () => {
  const lagging = await seed({ source: "gh:acme", lastSeenAt: new Date("2026-06-01T00:00:00Z") });
  const poolNewest = new Date("2026-08-24T00:00:00Z");
  assert.equal((await ids(radarWhere(f({}), { poolNewest, top: [], other: [] }))).includes(lagging.id), false);
  // Same row, pool also stale: nothing is retired because ingest paused.
  const paused = new Date("2026-06-02T00:00:00Z");
  assert.ok((await ids(radarWhere(f({}), { poolNewest: paused, top: [], other: [] }))).includes(lagging.id));
});

test("filters actually filter", async () => {
  const remote = await seed({ workMode: "remote", country: null, visaTier: "yes" });
  const onsite = await seed({ workMode: "onsite", visaTier: "no" });

  const byMode = await ids(radarWhere(f({ loc: "remote" }), { poolNewest: null, top: [], other: [] }));
  assert.ok(byMode.includes(remote.id));
  assert.equal(byMode.includes(onsite.id), false);

  const byVisa = await ids(radarWhere(f({ visa: "yes" }), { poolNewest: null, top: [], other: [] }));
  assert.ok(byVisa.includes(remote.id));
  assert.equal(byVisa.includes(onsite.id), false);

  const byText = await ids(radarWhere(f({ q: "Acme" }), { poolNewest: null, top: [], other: [] }));
  assert.ok(byText.includes(onsite.id));
  assert.equal((await ids(radarWhere(f({ q: "Nothingcorp" }), { poolNewest: null, top: [], other: [] }))).length, 0);
});

test.after(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
