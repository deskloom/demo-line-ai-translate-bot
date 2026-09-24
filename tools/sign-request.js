#!/usr/bin/env node
// Posts a correctly-signed sample LINE webhook to a target URL, for local
// testing against `wrangler dev`. Reads the channel secret from the
// LINE_CHANNEL_SECRET env var (never hardcode it).
//
// Usage:
//   LINE_CHANNEL_SECRET=devsecret node tools/sign-request.js http://127.0.0.1:8787/webhook
//   LINE_CHANNEL_SECRET=devsecret node tools/sign-request.js http://127.0.0.1:8787/webhook --bad-signature
//   LINE_CHANNEL_SECRET=devsecret node tools/sign-request.js http://127.0.0.1:8787/webhook --body-file ./sample.json

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

function defaultBody() {
  return JSON.stringify({
    destination: "Uxxxxdemoxxxx",
    events: [
      {
        type: "message",
        replyToken: "demo-reply-token",
        source: { type: "group", groupId: "Cdemo-group-1", userId: "Udemo-user-1" },
        timestamp: Date.now(),
        message: { id: "demo-msg-1", type: "text", text: "こんにちは、元気ですか？" },
      },
    ],
  });
}

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith("--"));
  const bad = args.includes("--bad-signature");
  const bodyFileFlagIdx = args.indexOf("--body-file");

  if (!url) {
    console.error("Usage: node tools/sign-request.js <url> [--bad-signature] [--body-file <path>]");
    process.exit(1);
  }

  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    console.error("LINE_CHANNEL_SECRET env var is required");
    process.exit(1);
  }

  const body =
    bodyFileFlagIdx >= 0 ? readFileSync(args[bodyFileFlagIdx + 1], "utf8") : defaultBody();

  const signature = bad
    ? "invalid-signature=="
    : createHmac("sha256", secret).update(body).digest("base64");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Line-Signature": signature },
    body,
  });
  console.log("status:", res.status);
  console.log(await res.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
