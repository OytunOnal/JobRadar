import { test } from "node:test";
import assert from "node:assert/strict";
import { mapItem } from "../src/lib/sources/indeed";

test("prefers the employer's own apply URL over the Indeed wall", () => {
  const j = mapItem({
    jobKey: "abc123",
    title: "LLM Engineer",
    company: { name: "Acme AI GmbH" },
    location: { city: "Berlin", countryCode: "DE" },
    url: "https://de.indeed.com/viewjob?jk=abc123",
    originalApplyUrl: "https://acme-ai.jobs.personio.de/job/999",
    datePosted: "2026-08-18",
    descriptionHtml: "<p>Build <b>agents</b>.</p>",
  }, "de")!;
  assert.equal(j.url, "https://acme-ai.jobs.personio.de/job/999"); // harvest food
  assert.equal(j.company, "Acme AI GmbH");
  assert.equal(j.location, "Berlin, DE");
  assert.equal(j.description, "Build agents .");
});

test("falls back to the Indeed URL; remote flag and string shapes", () => {
  const j = mapItem({
    id: "x9",
    title: "Dev",
    company: "Solo BV",
    location: "Remote",
    url: "https://nl.indeed.com/viewjob?jk=x9",
    isRemote: true,
    pubDate: 1787000000000,
  }, "nl")!;
  assert.equal(j.url, "https://nl.indeed.com/viewjob?jk=x9");
  assert.equal(j.remote, true);
  assert.equal(j.postedAt instanceof Date, true);
});

test("rows without id, title, or any url are dropped", () => {
  assert.equal(mapItem({ title: "no id" }, "de"), null);
  assert.equal(mapItem({ id: 1 }, "de"), null);
  assert.equal(mapItem({ id: 1, title: "no url at all" }, "de"), null);
});
