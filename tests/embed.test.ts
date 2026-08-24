import test from "node:test";
import assert from "node:assert/strict";
import { blendOrder, cosine, fromBuffer, jobEmbedText, normalize, toBuffer } from "../src/lib/llm/embed";

test("embed: buffer round-trip preserves the vector", () => {
  const v = normalize([0.1, -0.5, 0.7, 0.2]);
  const back = fromBuffer(toBuffer(v));
  v.forEach((x, i) => assert.ok(Math.abs(x - back[i]) < 1e-6));
});

test("embed: cosine of a normalized vector with itself is 1", () => {
  const v = normalize([3, 4]);
  assert.ok(Math.abs(cosine(v, v) - 1) < 1e-9);
});

test("blendOrder: two signals correct each other's blind spots", () => {
  // A: both like it; B: keyword-blind gem (embedding rescues);
  // C: keyword-inflated noise (embedding demotes); D: mediocre everywhere.
  const jobs = [
    { id: "A", score: 90, sim: 0.9 },
    { id: "B", score: 10, sim: 0.95 },
    { id: "C", score: 95, sim: 0.1 },
    { id: "D", score: 50, sim: 0.5 },
  ];
  const order = blendOrder(jobs).map((j: any) => j.id);
  assert.equal(order[0], "A"); // consensus wins
  // The keyword-blind gem lands ABOVE the keyword-inflated one at 40/60.
  assert.ok(order.indexOf("B") < order.indexOf("C"));
});

test("blendOrder: vectorless jobs ride their keyword rank, not the bottom", () => {
  const jobs = [
    { id: "high-kw-novec", score: 95, sim: null },
    { id: "mid", score: 60, sim: 0.6 },
    { id: "low", score: 20, sim: 0.2 },
  ];
  const order = blendOrder(jobs).map((j: any) => j.id);
  assert.equal(order[0], "high-kw-novec");
});

test("jobEmbedText: title-only rows embed on the title alone", () => {
  assert.equal(jobEmbedText("Unity Developer", "Unity Developer"), "Unity Developer");
  assert.ok(jobEmbedText("Dev", "A long description of the role with details beyond the title").includes("\n"));
});
