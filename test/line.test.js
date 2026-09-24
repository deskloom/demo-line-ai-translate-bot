import { test } from "node:test";
import assert from "node:assert/strict";
import { replyText, getDisplayName, fallbackSpeakerLabel } from "../src/line.js";

test("dry-run logs instead of sending when no access token is set", async () => {
  const env = {};
  const result = await replyText(env, "tok", ["hello"]);
  assert.equal(result.dryRun, true);
});

test("never sends empty text messages; skips entirely if all are empty", async () => {
  const env = { LINE_CHANNEL_ACCESS_TOKEN: "t" };
  let called = false;
  const fakeFetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };
  const result = await replyText(env, "tok", ["  ", ""], fakeFetch);
  assert.equal(result.skipped, true);
  assert.equal(called, false);
});

test("filters out blank entries but sends remaining non-empty ones", async () => {
  const env = { LINE_CHANNEL_ACCESS_TOKEN: "t" };
  let sentBody;
  const fakeFetch = async (url, init) => {
    sentBody = JSON.parse(init.body);
    return new Response("{}", { status: 200 });
  };
  const result = await replyText(env, "tok", ["", "hi", "  "], fakeFetch);
  assert.equal(result.sent, true);
  assert.deepEqual(
    sentBody.messages.map((m) => m.text),
    ["hi"]
  );
});

test("caps messages at 5 per reply call", async () => {
  const env = { LINE_CHANNEL_ACCESS_TOKEN: "t" };
  let sentBody;
  const fakeFetch = async (url, init) => {
    sentBody = JSON.parse(init.body);
    return new Response("{}", { status: 200 });
  };
  await replyText(env, "tok", ["1", "2", "3", "4", "5", "6", "7"], fakeFetch);
  assert.equal(sentBody.messages.length, 5);
});

test("throws on non-2xx LINE response", async () => {
  const env = { LINE_CHANNEL_ACCESS_TOKEN: "t" };
  const fakeFetch = async () => new Response("bad", { status: 400 });
  await assert.rejects(replyText(env, "tok", ["hi"], fakeFetch));
});

test("getDisplayName returns null when no token configured", async () => {
  const result = await getDisplayName({}, { type: "user", userId: "U123" });
  assert.equal(result, null);
});

test("fallbackSpeakerLabel never leaks the full userId", () => {
  const label = fallbackSpeakerLabel("Uabcdef1234567890");
  assert.equal(label, "user-567890");
  assert.ok(!label.includes("Uabcdef1234567890"));
});
