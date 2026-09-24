import { test } from "node:test";
import assert from "node:assert/strict";
import { computeChunkPlan, fitsBudget, planChunks } from "../src/chunk.js";

test("empty text yields no chunks", () => {
  assert.deepEqual(computeChunkPlan("", 100).chunks, []);
});

test("short text yields a single chunk", () => {
  const { chunks } = computeChunkPlan("hello world", 100);
  assert.deepEqual(chunks, ["hello world"]);
});

test("packs multiple short paragraphs into one chunk under budget", () => {
  const text = "para one\n\npara two\n\npara three";
  const { chunks } = computeChunkPlan(text, 100);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], text);
});

test("splits paragraphs across chunks when budget is tight", () => {
  const text = "a".repeat(10) + "\n\n" + "b".repeat(10) + "\n\n" + "c".repeat(10);
  const { chunks } = computeChunkPlan(text, 15);
  assert.equal(chunks.length, 3);
  for (const c of chunks) assert.ok(c.length <= 15);
});

test("hard-splits a single paragraph longer than the budget", () => {
  const text = "word ".repeat(50).trim(); // one paragraph, 249 chars
  const { chunks } = computeChunkPlan(text, 50);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 50);
  // No characters lost (modulo the join whitespace trimmed at cut points).
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), text.replace(/\s+/g, " "));
});

test("fitsBudget and planChunks agree by construction (same underlying function)", () => {
  const cases = [
    "",
    "short",
    "a".repeat(500),
    Array.from({ length: 10 }, (_, i) => `paragraph number ${i}`).join("\n\n"),
  ];
  for (const text of cases) {
    for (const budget of [10, 50, 200]) {
      for (const maxChunks of [1, 3, 5]) {
        const plan = computeChunkPlan(text, budget);
        const fits = fitsBudget(text, budget, maxChunks);
        assert.equal(fits, plan.chunks.length <= maxChunks);
        assert.deepEqual(planChunks(text, budget), plan.chunks);
      }
    }
  }
});

test("throws on a non-positive budget", () => {
  assert.throws(() => computeChunkPlan("hi", 0));
});
