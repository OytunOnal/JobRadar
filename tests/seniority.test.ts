import test from "node:test";
import assert from "node:assert/strict";
import { detectSeniority, levelBlocked } from "../src/lib/seniority";

test("detectSeniority: explicit title levels win", () => {
  assert.equal(detectSeniority("Staff Software Engineer", "").level, "staff");
  assert.equal(detectSeniority("Principal AI Engineer", "").level, "staff");
  assert.equal(detectSeniority("Senior Unity Developer", "").level, "senior");
  assert.equal(detectSeniority("Junior Developer", "").level, "junior");
  assert.equal(detectSeniority("Head of Engineering", "").level, "management");
  assert.equal(detectSeniority("Engineering Manager", "").level, "management");
  assert.equal(detectSeniority("Werkstudent Softwareentwicklung", "").level, "intern");
  assert.equal(detectSeniority("Starszy Programista", "").level, "senior"); // PL
});

test("detectSeniority: tech lead is IC unless the body says management", () => {
  assert.equal(detectSeniority("Tech Lead", "build systems in Go").level, "senior");
  assert.equal(detectSeniority("Tech Lead", "you will have 5 direct reports and run performance reviews").level, "management");
});

test("detectSeniority: years-of-experience fallback, multilingual", () => {
  assert.equal(detectSeniority("Software Engineer", "requires 8+ years of experience").level, "staff");
  assert.equal(detectSeniority("Software Engineer", "mindestens 6 Jahre Erfahrung").level, "senior");
  assert.equal(detectSeniority("Software Engineer", "minimum 3 years experience").level, "mid");
  assert.equal(detectSeniority("Software Engineer", "1 year of experience welcome").level, "junior");
});

test("detectSeniority: nothing stated -> unknown (stays neutral)", () => {
  assert.equal(detectSeniority("Software Engineer", "we build cool things").level, "unknown");
});

test("levelBlocked: maps structured levels onto avoid-word vocabulary", () => {
  const avoid = ["staff", "principal", "head of", "engineering manager"];
  assert.equal(levelBlocked("staff", avoid), true);
  assert.equal(levelBlocked("management", avoid), true);
  assert.equal(levelBlocked("senior", avoid), false);
  assert.equal(levelBlocked("unknown", avoid), false);
  assert.equal(levelBlocked("senior", ["senior"]), true); // TPM-style profile
});
