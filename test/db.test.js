import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeD1 } from "./fakeD1.js";
import { insertMessage, getRecentContext, deleteOlderThan } from "../src/db.js";

test("insertMessage then getRecentContext returns oldest-first within window", async () => {
  const db = createFakeD1();
  const base = 1_000_000;
  await insertMessage(db, {
    id: "1",
    sourceId: "s1",
    speakerLabel: "host",
    lang: "ja",
    text: "元気ですか",
    translation: "How are you?",
    createdAt: base,
  });
  await insertMessage(db, {
    id: "2",
    sourceId: "s1",
    speakerLabel: "student",
    lang: "en",
    text: "I'm good",
    translation: "元気です",
    createdAt: base + 1000,
  });

  const ctx = await getRecentContext(db, "s1", base + 2000, 60_000, 10);
  assert.equal(ctx.length, 2);
  assert.equal(ctx[0].text, "元気ですか");
  assert.equal(ctx[1].text, "I'm good");
});

test("getRecentContext excludes messages outside the time window", async () => {
  const db = createFakeD1();
  const base = 1_000_000;
  await insertMessage(db, {
    id: "1",
    sourceId: "s1",
    speakerLabel: "host",
    lang: "ja",
    text: "old message",
    translation: null,
    createdAt: base,
  });
  const ctx = await getRecentContext(db, "s1", base + 100_000, 5_000, 10);
  assert.equal(ctx.length, 0);
});

test("getRecentContext respects limit and source isolation", async () => {
  const db = createFakeD1();
  const base = 1_000_000;
  for (let i = 0; i < 5; i++) {
    await insertMessage(db, {
      id: String(i),
      sourceId: "s1",
      speakerLabel: "host",
      lang: "en",
      text: `msg ${i}`,
      translation: null,
      createdAt: base + i * 100,
    });
  }
  await insertMessage(db, {
    id: "other",
    sourceId: "s2",
    speakerLabel: "host",
    lang: "en",
    text: "different source",
    translation: null,
    createdAt: base + 50,
  });

  const ctx = await getRecentContext(db, "s1", base + 1000, 60_000, 3);
  assert.equal(ctx.length, 3);
  assert.deepEqual(
    ctx.map((c) => c.text),
    ["msg 2", "msg 3", "msg 4"]
  );
});

test("deleteOlderThan removes only stale rows and reports count", async () => {
  const db = createFakeD1();
  const base = 1_000_000;
  await insertMessage(db, {
    id: "old",
    sourceId: "s1",
    speakerLabel: "host",
    lang: "en",
    text: "old",
    translation: null,
    createdAt: base,
  });
  await insertMessage(db, {
    id: "new",
    sourceId: "s1",
    speakerLabel: "host",
    lang: "en",
    text: "new",
    translation: null,
    createdAt: base + 100_000,
  });

  const deleted = await deleteOlderThan(db, base + 50_000);
  assert.equal(deleted, 1);
  const remaining = await getRecentContext(db, "s1", base + 200_000, 1_000_000, 10);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].text, "new");
});
