import test from "node:test";
import assert from "node:assert/strict";
import { betterText } from "../src/lib/ingest";

test("takes the incoming text when we have nothing", () => {
  assert.equal(betterText("Real body", ""), true);
  assert.equal(betterText("Real body", null), true);
});

test("structure wins over length — this is how the flat pool gets repaired", () => {
  const structured = "Requirements:\n- Unity\n- C#";
  const flatButLonger = "Requirements: Unity, C#, and a long tail of prose. ".repeat(3);
  assert.equal(betterText(structured, flatButLonger), false); // 0.8x floor not met
  assert.equal(betterText(structured + " padding".repeat(20), flatButLonger), true);
});

test("never flattens a posting we already hold with structure", () => {
  assert.equal(betterText("One long flat line. ".repeat(50), "Tasks:\n- build"), false);
});

test("does not clobber a desc:fill body with a list payload", () => {
  // Connectors whose list endpoint carries no body store the title; desc:fill
  // enriches later. The next sweep must not undo that.
  assert.equal(betterText("Senior Unity Developer", "A full 2000-character body. ".repeat(80)), false);
});

test("accepts a genuinely richer re-sighting (the posting was edited)", () => {
  assert.equal(betterText("body ".repeat(300), "body ".repeat(200)), true);
  assert.equal(betterText("body ".repeat(205), "body ".repeat(200)), false); // noise, not an edit
});
