import { test } from "node:test";
import assert from "node:assert/strict";
import { mapItem } from "../src/lib/sources/linkedin";

test("prefers the company's own apply URL over the LinkedIn wall", () => {
  const j = mapItem({
    id: 123,
    title: "Senior Unity Developer",
    company: { name: "Acme Games" },
    location: { linkedinText: "Berlin, Germany" },
    workplaceType: "Hybrid",
    linkedinUrl: "https://www.linkedin.com/jobs/view/123/",
    applyMethod: { companyApplyUrl: "https://jobs.lever.co/acmegames/uuid" },
    postedDate: "2026-08-18T10:00:00Z",
    descriptionHtml: "<p>Build <b>games</b>.</p>",
  })!;
  assert.equal(j.url, "https://jobs.lever.co/acmegames/uuid"); // harvest food
  assert.equal(j.company, "Acme Games");
  assert.equal(j.workMode, "hybrid");
  assert.equal(j.description, "Build games .");
  assert.equal(j.postedAt?.toISOString().slice(0, 10), "2026-08-18");
});

test("falls back to the LinkedIn URL and handles string company/location", () => {
  const j = mapItem({
    jobId: "456",
    title: "Dev",
    company: "Solo GmbH",
    location: "Remote",
    workplaceType: "Remote",
  })!;
  assert.equal(j.url, "https://www.linkedin.com/jobs/view/456/");
  assert.equal(j.remote, true);
  assert.equal(j.workMode, "remote");
});

test("epoch-seconds dates and junk rows", () => {
  const j = mapItem({ id: 9, title: "X", listedAt: 1787000000 })!;
  assert.equal(j.postedAt instanceof Date, true);
  assert.equal(mapItem({ id: "", title: "no id" }), null);
  assert.equal(mapItem({ id: 1 }), null); // no title
});
