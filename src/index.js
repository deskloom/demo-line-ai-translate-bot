// LINE group chat auto-translation bot (ja<->en) on Cloudflare Workers + D1.
// Portfolio demo. Fictional conversation data only.

import { verifyLineSignature } from "./signature.js";
import { detectLang, isUntranslatable } from "./lang.js";
import { translateMessage } from "./translate.js";
import { replyText, getDisplayName, fallbackSpeakerLabel } from "./line.js";
import { insertMessage, getRecentContext, deleteOlderThan } from "./db.js";
import { fitsBudget, planChunks } from "./chunk.js";

const MAX_REPLY_CHUNKS = 5; // LINE Messaging API allows at most 5 messages per reply call.

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/webhook") {
      return handleWebhook(request, env, ctx);
    }
    if (request.method === "GET" && url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRetentionSweep(env));
  },
};

async function handleWebhook(request, env, ctx) {
  const rawBody = await request.text();
  const signature = request.headers.get("X-Line-Signature");
  const ok = await verifyLineSignature(rawBody, signature, env.LINE_CHANNEL_SECRET || "");
  if (!ok) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Signature was valid but body isn't JSON; still 200 quickly, nothing to do.
    return new Response("ok", { status: 200 });
  }

  // Respond fast; do the real work in the background.
  ctx.waitUntil(processEvents(payload, env));
  return new Response("ok", { status: 200 });
}

async function processEvents(payload, env) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  for (const event of events) {
    try {
      await processOneEvent(event, env);
    } catch (err) {
      console.log("[webhook] event processing failed", String(err));
    }
  }
}

async function processOneEvent(event, env) {
  if (event.type !== "message" || event.message?.type !== "text") return;

  const text = event.message.text ?? "";
  const sourceId = event.source?.groupId || event.source?.roomId || event.source?.userId;
  if (!sourceId) return;

  if (isUntranslatable(text)) {
    console.log("[webhook] skip untranslatable message", { sourceId });
    return;
  }

  const lang = detectLang(text);
  if (lang === "unknown") {
    console.log("[webhook] skip: could not detect language", { sourceId });
    return;
  }
  const targetLang = lang === "ja" ? "en" : "ja";

  const contextWindowMs = Number(env.CONTEXT_WINDOW_MINUTES ?? 30) * 60 * 1000;
  const contextLimit = Number(env.CONTEXT_WINDOW_MESSAGES ?? 8);
  const now = Date.now();

  const contextMessages = env.DB
    ? await getRecentContext(env.DB, sourceId, now, contextWindowMs, contextLimit)
    : [];

  const displayName = await getDisplayName(env, event.source);
  const speakerLabel = displayName || fallbackSpeakerLabel(event.source?.userId);

  const budget = Number(env.REPLY_CHAR_BUDGET ?? 1800);

  if (!fitsBudget(text, budget, MAX_REPLY_CHUNKS)) {
    console.log("[webhook] skip: message too long to process within budget", {
      sourceId,
      length: text.length,
    });
    return;
  }

  const chunks = planChunks(text, budget);
  const translatedChunks = [];
  for (const chunk of chunks) {
    const { translation } = await translateMessage({
      text: chunk,
      sourceLang: lang,
      targetLang,
      contextMessages,
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
    });
    translatedChunks.push(translation);
  }
  const translation = translatedChunks.filter((t) => t && t.trim().length > 0).join("\n\n");

  if (env.DB) {
    await insertMessage(env.DB, {
      id: event.message.id || crypto.randomUUID(),
      sourceId,
      speakerLabel,
      lang,
      text,
      translation: translation || null,
      createdAt: now,
    });
  }

  if (!translation.trim()) {
    console.log("[webhook] no translation produced; not replying", { sourceId });
    return;
  }

  const replyToken = event.replyToken;
  if (!replyToken) return;

  // Split the translated output itself into reply-sized chunks too, using the
  // same budget/plan function, so a long translation still respects LINE's
  // per-message size and the 5-messages-per-reply limit.
  const replyChunks = fitsBudget(translation, budget, MAX_REPLY_CHUNKS)
    ? planChunks(translation, budget)
    : planChunks(translation, budget).slice(0, MAX_REPLY_CHUNKS);

  await replyText(env, replyToken, replyChunks);
}

async function runRetentionSweep(env) {
  if (!env.DB) return;
  const retentionHours = Number(env.RETENTION_HOURS ?? 72);
  const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
  const deleted = await deleteOlderThan(env.DB, cutoff);
  console.log("[scheduled] retention sweep", { retentionHours, deleted });
}
