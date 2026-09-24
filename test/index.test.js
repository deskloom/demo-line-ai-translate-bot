import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../src/index.js";
import { createFakeD1 } from "./fakeD1.js";

function sign(secret, body) {
  return createHmac("sha256", secret).update(body).digest("base64");
}

function makeCtx() {
  const promises = [];
  return {
    waitUntil(p) {
      promises.push(p);
    },
    async flush() {
      await Promise.all(promises);
    },
  };
}

function sampleBody(text) {
  return JSON.stringify({
    destination: "Udemo",
    events: [
      {
        type: "message",
        replyToken: "reply-1",
        source: { type: "group", groupId: "Cgroup1", userId: "Uuser1" },
        timestamp: Date.now(),
        message: { id: "m1", type: "text", text },
      },
    ],
  });
}

function baseEnv(overrides = {}) {
  return {
    LINE_CHANNEL_SECRET: "test-secret",
    DB: createFakeD1(),
    REPLY_CHAR_BUDGET: "1800",
    CONTEXT_WINDOW_MESSAGES: "8",
    CONTEXT_WINDOW_MINUTES: "30",
    ...overrides,
  };
}

test("rejects missing signature with 401", async () => {
  const env = baseEnv();
  const req = new Request("http://localhost/webhook", {
    method: "POST",
    body: sampleBody("hello"),
  });
  const res = await worker.fetch(req, env, makeCtx());
  assert.equal(res.status, 401);
});

test("rejects bad signature with 401", async () => {
  const env = baseEnv();
  const req = new Request("http://localhost/webhook", {
    method: "POST",
    headers: { "X-Line-Signature": "bm9wZQ==" },
    body: sampleBody("hello"),
  });
  const res = await worker.fetch(req, env, makeCtx());
  assert.equal(res.status, 401);
});

test("accepts valid signature, returns 200 immediately, stores message and dry-run-replies via waitUntil", async () => {
  const env = baseEnv();
  const body = sampleBody("こんにちは");
  const sig = sign(env.LINE_CHANNEL_SECRET, body);
  const req = new Request("http://localhost/webhook", {
    method: "POST",
    headers: { "X-Line-Signature": sig },
    body,
  });
  const ctx = makeCtx();
  const res = await worker.fetch(req, env, ctx);
  assert.equal(res.status, 200);

  await ctx.flush();

  assert.equal(env.DB._rows.length, 1);
  assert.equal(env.DB._rows[0].lang, "ja");
  assert.ok(env.DB._rows[0].translation.includes("mock ja->en"));
});

test("emoji-only message is skipped: no DB row, no reply", async () => {
  const env = baseEnv();
  const body = sampleBody("😀😀😀");
  const sig = sign(env.LINE_CHANNEL_SECRET, body);
  const req = new Request("http://localhost/webhook", {
    method: "POST",
    headers: { "X-Line-Signature": sig },
    body,
  });
  const ctx = makeCtx();
  const res = await worker.fetch(req, env, ctx);
  assert.equal(res.status, 200);
  await ctx.flush();
  assert.equal(env.DB._rows.length, 0);
});

test("healthz endpoint", async () => {
  const res = await worker.fetch(new Request("http://localhost/healthz"), baseEnv(), makeCtx());
  assert.equal(res.status, 200);
});

test("unknown route 404s", async () => {
  const res = await worker.fetch(new Request("http://localhost/nope"), baseEnv(), makeCtx());
  assert.equal(res.status, 404);
});

test("scheduled handler runs retention sweep and deletes stale rows", async () => {
  const env = baseEnv({ RETENTION_HOURS: "1" });
  const now = Date.now();
  await env.DB
    .prepare(
      `INSERT INTO messages (id, source_id, speaker_label, lang, text, translation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind("old", "s1", "host", "en", "old msg", null, now - 2 * 60 * 60 * 1000)
    .run();
  await env.DB
    .prepare(
      `INSERT INTO messages (id, source_id, speaker_label, lang, text, translation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind("new", "s1", "host", "en", "new msg", null, now)
    .run();

  const ctx = makeCtx();
  await worker.scheduled({ cron: "0 * * * *" }, env, ctx);
  await ctx.flush();

  assert.equal(env.DB._rows.length, 1);
  assert.equal(env.DB._rows[0].id, "new");
});
