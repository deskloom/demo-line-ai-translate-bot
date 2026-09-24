import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyLineSignature } from "../src/signature.js";

function sign(secret, body) {
  return createHmac("sha256", secret).update(body).digest("base64");
}

test("accepts a correctly signed body", async () => {
  const secret = "test-secret";
  const body = JSON.stringify({ events: [] });
  const sig = sign(secret, body);
  assert.equal(await verifyLineSignature(body, sig, secret), true);
});

test("rejects a bad signature", async () => {
  const secret = "test-secret";
  const body = JSON.stringify({ events: [] });
  assert.equal(await verifyLineSignature(body, "bm9wZQ==", secret), false);
});

test("rejects when signature header is missing", async () => {
  const secret = "test-secret";
  const body = JSON.stringify({ events: [] });
  assert.equal(await verifyLineSignature(body, null, secret), false);
});

test("rejects when channel secret is empty", async () => {
  const body = JSON.stringify({ events: [] });
  const sig = sign("test-secret", body);
  assert.equal(await verifyLineSignature(body, sig, ""), false);
});

test("rejects if the body was tampered with", async () => {
  const secret = "test-secret";
  const body = JSON.stringify({ events: [] });
  const sig = sign(secret, body);
  const tampered = JSON.stringify({ events: [{ tampered: true }] });
  assert.equal(await verifyLineSignature(tampered, sig, secret), false);
});
