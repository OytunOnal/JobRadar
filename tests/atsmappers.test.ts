import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RawJob } from "../src/lib/sources/types";

import { mapGreenhouseJob } from "../src/lib/sources/ats/greenhouse";
import { mapLeverJob, leverSections } from "../src/lib/sources/ats/lever";
import { mapAshbyJob } from "../src/lib/sources/ats/ashby";
import { mapSmartRecruitersJob } from "../src/lib/sources/ats/smartrecruiters";
import { mapWorkableJob } from "../src/lib/sources/ats/workable";
import { mapRecruiteeOffer } from "../src/lib/sources/ats/recruitee";
import { parsePersonioFeed } from "../src/lib/sources/ats/personio";
import { mapWorkdayPosting, workdayPostedAt } from "../src/lib/sources/ats/workday";
import { parseTeamtailorFeed } from "../src/lib/sources/ats/teamtailor";
import { mapBambooRows } from "../src/lib/sources/ats/bamboohr";
import { mapBreezyRows } from "../src/lib/sources/ats/breezy";
import { parseJoinState, mapJoinItems } from "../src/lib/sources/ats/join";
import { mapPinpointRows } from "../src/lib/sources/ats/pinpoint";
import { mapOracleReq } from "../src/lib/sources/ats/oracle";
import { mapBeesiteItem } from "../src/lib/sources/ats/beesite";
import { mapSuccessFactorsRow, parseLocales } from "../src/lib/sources/ats/successfactors";
import { mapEightfoldPosition } from "../src/lib/sources/ats/eightfold";
import { mapJibeRow } from "../src/lib/sources/ats/jibe";
import { mapRipplingRows } from "../src/lib/sources/ats/rippling";
import { mapPhenomJob } from "../src/lib/sources/ats/phenom";
import { mapGemPosting } from "../src/lib/sources/ats/gem";
import { mapComeetPosition, extractComeetToken } from "../src/lib/sources/ats/comeet";
import { mapGetroJob, extractGetroNetworkId } from "../src/lib/sources/ats/getro";
import { parseAvatureFeed } from "../src/lib/sources/ats/avature";
import { parseRadancyFragment } from "../src/lib/sources/ats/radancy";
import { mapCsodRequisition, extractCsodJwt } from "../src/lib/sources/ats/csod";
import { parseJobviteFeed, extractJobviteEid } from "../src/lib/sources/ats/jobvite";
import { parseSoftgardenPage } from "../src/lib/sources/ats/softgarden";
import { atsFetchers } from "../src/lib/sources/ats";

// 1,021 lines, 28 adapters, zero tests — and the uncovered source files were
// exactly the ones with no exported mapper. Testability and coverage were the
// same fact, because every mapping lived inside its fetch and needed a network
// call to reach. Now each platform's mapping is a pure function, and each is
// checked against a recorded response. See PROVENANCE.md for which of these
// captures are real and which were derived from the code.

const DIR = join("tests", "fixtures", "ats");
const json = (name: string) => JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8"));
const text = (name: string) => readFileSync(join(DIR, `${name}.txt`), "utf8");

// Every mapper must produce a posting that ingest can actually store.
function assertUsable(j: RawJob, where: string) {
  assert.ok(j.source, `${where}: source`);
  assert.ok(j.externalId, `${where}: externalId`);
  assert.ok(j.title.trim(), `${where}: title`);
  assert.equal(j.title, j.title.trim(), `${where}: title is trimmed`);
  assert.equal(typeof j.remote, "boolean", `${where}: remote`);
  assert.ok(typeof j.description === "string", `${where}: description`);
  if (j.postedAt) assert.equal(Number.isNaN(j.postedAt.getTime()), false, `${where}: postedAt is a real date`);
}

test("greenhouse maps a real board response", () => {
  const jobs = (json("greenhouse").jobs ?? []).map((j: any) => mapGreenhouseJob(j, "datakindinc", "DataKind"));
  assert.ok(jobs.length > 0);
  for (const j of jobs) assertUsable(j, "greenhouse");
  assert.match(jobs[0].source, /^gh:datakindinc$/);
  // Greenhouse content arrives HTML-ENCODED — the bug that cost 47-58% of a
  // stored description. Whatever else changes, this must stay converted.
  assert.equal(/<(p|div|li|ul|strong)\b/i.test(jobs[0].description), false, jobs[0].description.slice(0, 120));
});

test("lever keeps its named blocks and its EU namespace", () => {
  const rows = json("lever");
  const jobs = rows.map((j: any) => mapLeverJob(j, "blackshark", "Blackshark"));
  assert.ok(jobs.length > 0);
  for (const j of jobs) assertUsable(j, "lever");
  // The `lists` blocks are Lever's own headings — the thing this connector
  // used to throw away by taking descriptionPlain alone.
  const parts = leverSections(rows[0]);
  assert.ok(parts.length >= 2, "intro + at least one named list");
  assert.ok(jobs[0].sections, "sections cross the seam");
});

test("ashby prefers the HTML body over the flattened one", () => {
  const jobs = (json("ashby").jobs ?? []).map((j: any) => mapAshbyJob(j, "aida", "Aida"));
  assert.ok(jobs.length > 0);
  for (const j of jobs) assertUsable(j, "ashby");
  assert.equal(/<(p|div|li)\b/i.test(jobs[0].description), false);
});

test("smartrecruiters and workable fall back to the title, having no body", () => {
  const sr = (json("smartrecruiters").content ?? []).map((j: any) => mapSmartRecruitersJob(j, "iungospa", "IUNGO"));
  assert.ok(sr.length > 0);
  for (const j of sr) {
    assertUsable(j, "smartrecruiters");
    assert.equal(j.description, j.title === "" ? "" : j.description);
  }
  const wk = json("workable");
  const jobs = (wk.jobs ?? []).map((j: any) => mapWorkableJob(j, "99xbrazil", "fallback", wk.name));
  assert.ok(jobs.length > 0);
  for (const j of jobs) assertUsable(j, "workable");
  if (wk.name) assert.equal(jobs[0].company, wk.name, "the board's own name wins over the registry's");
});

test("recruitee reports an explicit work mode when the source states one", () => {
  const jobs = (json("recruitee").offers ?? []).map((o: any) => mapRecruiteeOffer(o, "siwaresystems", "Si-Ware"));
  assert.ok(jobs.length > 0);
  for (const j of jobs) {
    assertUsable(j, "recruitee");
    if (j.workMode) assert.ok(["remote", "hybrid"].includes(j.workMode));
  }
});

test("personio pairs each section heading with its value", () => {
  const jobs = parsePersonioFeed(text("personio"), "abcfinlab", "Abcfinlab");
  assert.ok(jobs.length > 0);
  for (const j of jobs) assertUsable(j, "personio");
  // The <name>/<value> pairing is the most intricate parse in this layer, and
  // its documented failure mode was joining the values with a space and
  // discarding every heading.
  const withSections = jobs.find((j) => (j.sections?.length ?? 0) > 0);
  if (withSections) {
    assert.ok(withSections.sections!.some(([h]) => h.length > 0), "at least one heading survived");
  }
});

test("workday turns its relative posting strings into dates", () => {
  const data = json("workday");
  const ctx = { token: "xboxgaming@wd1/centraltech", company: "Xbox", base: "https://x.wd1.myworkdayjobs.com", site: "centraltech" };
  const jobs = (data.jobPostings ?? []).map((p: any) => mapWorkdayPosting(p, ctx));
  assert.ok(jobs.length > 0);
  for (const j of jobs) assertUsable(j, "workday");

  const now = new Date("2026-08-24T00:00:00Z");
  assert.equal(workdayPostedAt("Posted Today", now)?.toISOString().slice(0, 10), "2026-08-24");
  assert.equal(workdayPostedAt("Posted Yesterday", now)?.toISOString().slice(0, 10), "2026-08-23");
  assert.equal(workdayPostedAt("Posted 3 Days Ago", now)?.toISOString().slice(0, 10), "2026-08-21");
  // "30+" is unbounded — unknown beats inventing a date.
  assert.equal(workdayPostedAt("Posted 30+ Days Ago", now), undefined);
  assert.equal(workdayPostedAt(undefined, now), undefined);
});

test("teamtailor reads its RSS items", () => {
  const jobs = parseTeamtailorFeed(text("teamtailor"), "psv", "PSV");
  assert.ok(jobs.length > 0);
  for (const j of jobs) assertUsable(j, "teamtailor");
});

test("bamboohr and breezy drop the rows they cannot identify", () => {
  const bb = mapBambooRows(json("bamboohr").result, "anyip", "Anyip");
  for (const j of bb) assertUsable(j, "bamboohr");
  const bz = mapBreezyRows(json("breezy"), "mantic", "Mantic");
  for (const j of bz) assertUsable(j, "breezy");
  // Breezy rows without an https url are unusable, not merely odd.
  assert.equal(mapBreezyRows([{ name: "x", url: "javascript:alert(1)" }], "t", "c").length, 0);
});

test("join reads the embedded state, and survives a page without one", () => {
  const state = parseJoinState(text("join"));
  assert.ok(state, "the __NEXT_DATA__ block parsed");
  const jobs = mapJoinItems(state?.jobs?.items ?? [], "02100", "02100", state?.company?.domain ?? "02100");
  for (const j of jobs) assertUsable(j, "join");
  assert.equal(parseJoinState("<html>no next data here</html>"), null);
  assert.equal(parseJoinState('<script id="__NEXT_DATA__">{not json</script>'), null);
});

test("pinpoint carries compensation and refuses a non-https url", () => {
  const jobs = mapPinpointRows(json("pinpoint").data, "acme", "Acme");
  assert.equal(jobs.length, 1, "the ftp:// row is dropped");
  assertUsable(jobs[0], "pinpoint");
  assert.equal(jobs[0].salaryText, "£70,000 - £85,000");
  assert.equal(jobs[0].remote, true);
});

test("oracle reports its three named blocks", () => {
  const item = json("oracle").items[0];
  const ctx = { token: "eeho.fa.us2@CX_45001", company: "Acme", host: "eeho.fa.us2.oraclecloud.com", site: "CX_45001" };
  const jobs = item.requisitionList.map((j: any) => mapOracleReq(j, ctx)).filter(Boolean) as RawJob[];
  assert.equal(jobs.length, 1, "the row without an Id is dropped");
  assertUsable(jobs[0], "oracle");
  assert.deepEqual(jobs[0].sections!.map(([h]) => h), ["", "Responsibilities", "Requirements"]);
  assert.equal(jobs[0].location, "Berlin, Germany; Munich, Germany");
});

test("beesite joins multiple locations and keeps the branded url", () => {
  const items = json("beesite").SearchResult.SearchResultItems;
  const jobs = items.map((it: any) => mapBeesiteItem(it, "mercedes", "Mercedes")).filter(Boolean) as RawJob[];
  assert.equal(jobs.length, 1);
  assertUsable(jobs[0], "beesite");
  assert.equal(jobs[0].location, "Stuttgart, Germany; Berlin, Germany");
  assert.equal(jobs[0].remote, true, "the title says Remote");
});

test("successfactors puts English locales first", () => {
  // The quirk this connector exists for: query one locale and you see a
  // twentieth of the board (live-verified de_DE=601 vs en_US=8).
  assert.deepEqual(parseLocales('locale=de_DE locale=en_US locale=fr_FR'), ["en_US", "de_DE", "fr_FR"]);
  assert.deepEqual(parseLocales("no locales here"), ["en_US", "de_DE"]);

  const rows = json("successfactors").jobSearchResult;
  const jobs = rows.map((r: any) => mapSuccessFactorsRow(r, { token: "jobs.man.eu", company: "MAN", origin: "https://jobs.man.eu", locale: "en_US" })).filter(Boolean) as RawJob[];
  assert.equal(jobs.length, 1);
  assertUsable(jobs[0], "successfactors");
  assert.equal(jobs[0].remote, true, "Home Office counts");
});

test("eightfold reads unix SECONDS, not milliseconds", () => {
  const jobs = json("eightfold").positions.map((j: any) => mapEightfoldPosition(j, "bayer", "Bayer")).filter(Boolean) as RawJob[];
  assert.equal(jobs.length, 1);
  assertUsable(jobs[0], "eightfold");
  assert.equal(jobs[0].postedAt?.getUTCFullYear(), 2025, "seconds read as ms would land in 1970");
  assert.equal(jobs[0].remote, true);
});

test("jibe keeps the full description its API actually ships", () => {
  const jobs = json("jibe").jobs.map((r: any) => mapJibeRow(r, "nfiindustries", "NFI")).filter(Boolean) as RawJob[];
  assert.equal(jobs.length, 1);
  assertUsable(jobs[0], "jibe");
  assert.equal(/<p\b/i.test(jobs[0].description), false);
  assert.ok(jobs[0].description.includes("WMS"));
});

test("rippling merges the one-row-per-location duplicates", () => {
  const jobs = mapRipplingRows(json("rippling"), "acme", "Acme");
  assert.equal(jobs.length, 1, "two rows, one uuid, one posting");
  assert.equal(jobs[0].location, "Berlin; Remote");
  assertUsable(jobs[0], "rippling");
});

test("phenom converts the teaser it used to store raw", () => {
  const jobs = json("phenom").refineSearch.data.jobs.map((j: any) => mapPhenomJob(j, "careers.allianz.com", "Allianz")).filter(Boolean) as RawJob[];
  assert.equal(jobs.length, 1);
  assertUsable(jobs[0], "phenom");
  assert.equal(/<p\b/i.test(jobs[0].description), false);
  assert.ok(jobs[0].description.includes("&") && !jobs[0].description.includes("&amp;"), "entities decoded");
});

test("gem reads remote out of its location records", () => {
  const rows = json("gem")[0].data.oatsExternalJobPostings.jobPostings;
  const jobs = rows.map((j: any) => mapGemPosting(j, "acme", "Acme")).filter(Boolean) as RawJob[];
  assert.equal(jobs.length, 1);
  assertUsable(jobs[0], "gem");
  assert.equal(jobs[0].remote, true);
});

test("comeet reports its two named blocks, and its bootstrap is checkable", () => {
  const jobs = json("comeet").map((j: any) => mapComeetPosition(j, "acme/77", "Acme")).filter(Boolean) as RawJob[];
  assert.equal(jobs.length, 1);
  assertUsable(jobs[0], "comeet");
  assert.deepEqual(jobs[0].sections!.map(([h]) => h), ["", "Requirements"]);
  assert.equal(extractComeetToken('{"token":"ABC123DEF"}'), "ABC123DEF");
  assert.equal(extractComeetToken("<html>nothing</html>"), null);
});

test("getro prefers the portfolio company's own name", () => {
  const jobs = json("getro").results.jobs.map((j: any) => mapGetroJob(j, "jobs.b2venture.vc", "b2venture")).filter(Boolean) as RawJob[];
  assert.equal(jobs.length, 1);
  assertUsable(jobs[0], "getro");
  assert.equal(jobs[0].company, "Acme Robotics", "the employer, not the network");
  assert.equal(extractGetroNetworkId('"network":{"id":"1234"'), "1234");
  assert.equal(extractGetroNetworkId("<html/>"), null);
});

test("avature splits location off its description convention", () => {
  const jobs = parseAvatureFeed(text("avature"), "careers.avature.net/en_US/main", "Acme");
  assert.equal(jobs.length, 2);
  for (const j of jobs) assertUsable(j, "avature");
  assert.equal(jobs[0].location, "Argentina", '"Argentina - 7221" convention');
  assert.equal(jobs[0].externalId, "12345", "the id comes out of the link");
  assert.equal(jobs[1].remote, true);
});

test("radancy dedupes its anchors and ignores non-job links", () => {
  const frag = json("radancy").results;
  const jobs = parseRadancyFragment(frag, "careers.munichre.com/en", "careers.munichre.com");
  const unique = new Map(jobs.map((j) => [j.externalId, j]));
  assert.equal(unique.size, 2, "duplicate anchor collapsed, /about ignored");
  // The href ends with the id — checked against 1,424 stored radancy rows,
  // none of which fell back to using the URL. My first fixture guessed a
  // trailing slug and this assertion is what caught the guess.
  assert.equal(jobs[0].externalId, "43248780096");
  assert.ok(jobs.some((j) => j.remote), "Remote Data Scientist");
});

test("csod maps a requisition, and its JWT bootstrap is checkable", () => {
  const rows = json("csod").data.requisitions;
  const ctx = { token: "career-ohb@4", company: "OHB", origin: "https://career-ohb.csod.com", siteId: "4", sub: "career-ohb" };
  const jobs = rows.map((j: any) => mapCsodRequisition(j, ctx)).filter(Boolean) as RawJob[];
  assert.equal(jobs.length, 1);
  assertUsable(jobs[0], "csod");
  assert.equal(jobs[0].location, "Bremen, Germany");
  assert.equal(extractCsodJwt('"token":"eyJhbGci.abc-123_x"'), "eyJhbGci.abc-123_x");
  assert.equal(extractCsodJwt("<html/>"), null);
});

test("jobvite joins location and region, and its bootstrap is checkable", () => {
  const jobs = parseJobviteFeed(text("jobvite"), "acme", "Acme");
  assert.equal(jobs.length, 1, "the row without an id is dropped");
  assertUsable(jobs[0], "jobvite");
  assert.equal(jobs[0].location, "Austin, TX");
  assert.equal(extractJobviteEid("companyEId: 'qP19Vfwd'"), "qP19Vfwd");
  assert.equal(extractJobviteEid("<html/>"), null);
});

test("softgarden dedupes its anchors and ignores non-job links", () => {
  const jobs = parseSoftgardenPage(text("softgarden"), "acme", "Acme");
  assert.equal(jobs.length, 2);
  for (const j of jobs) assertUsable(j, "softgarden");
  assert.equal(jobs[0].externalId, "771234");
  assert.equal(jobs[1].remote, true);
});

test("manatal maps the recorded page: hash ids, slug URLs, stripped bodies", async () => {
  const { mapManatalJob } = await import("../src/lib/sources/ats/manatal");
  const page = json("manatal");
  const jobs = page.results.map((j: any) => mapManatalJob(j, "elevus", "Elevus")).filter(Boolean);
  assert.equal(jobs.length, page.results.length);
  for (const j of jobs) {
    assertUsable(j, "manatal");
    assert.match(j.externalId, /^[A-Z0-9]+$/);
    assert.ok(j.url.includes("/elevus/job/"));
    assert.ok(!j.description.includes("<"), "HTML stripped");
  }
});

test("hrmanager: the title is Name, the date is .NET, the body is the ad", async () => {
  const { mapHrManagerJob, parseDotNetDate } = await import("../src/lib/sources/ats/hrmanager");
  const page = json("hrmanager");
  assert.equal(page.CustomerName, "Energinet");
  const jobs = page.Items.map((p: any) => mapHrManagerJob(p, "energinet", page.CustomerName)).filter(Boolean);
  assert.equal(jobs.length, page.Items.length);
  for (const j of jobs) {
    assertUsable(j, "hrmanager");
    assert.ok(!j.description.includes("<"), "ad HTML stripped");
    // Department objects carry Name too; the mapper must read the POSITION's.
    assert.notEqual(j.title, "Energinet", "the company name is not a job title");
  }
  // .NET dates: the epoch millis decide the instant, the offset is decoration.
  assert.equal(parseDotNetDate("/Date(1787911491000+0200)/")?.toISOString(), new Date(1787911491000).toISOString());
  assert.equal(parseDotNetDate("2026-08-28"), undefined, "an ISO string is not a .NET date");
  assert.equal(parseDotNetDate(null), undefined);
});

// ── The guards ───────────────────────────────────────────────────────────

test("every registered platform has a fixture", () => {
  const have = new Set(readdirSync(DIR).map((f) => f.replace(/\.(json|txt)$/, "")));
  const missing = Object.keys(atsFetchers).filter((p) => !have.has(p));
  assert.deepEqual(missing, [], `no recorded response for: ${missing.join(", ")}`);
});

test("every platform is its own module, and the registry is only a registry", () => {
  // The 1,021-line file this replaced mixed 28 platforms' quirks together, so
  // a reader could not tell whose oddity was whose.
  const files = readdirSync(join("src", "lib", "sources", "ats"));
  for (const p of Object.keys(atsFetchers)) {
    assert.ok(files.includes(`${p}.ts`), `${p} needs its own module`);
  }
  const index = readFileSync(join("src", "lib", "sources", "ats", "index.ts"), "utf8");
  assert.equal(/https?:\/\//.test(index.replace(/\/\/.*$/gm, "")), false, "no URL belongs in the registry");
});
