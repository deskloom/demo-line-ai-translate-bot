// Thin wrapper around the LINE Messaging API reply + profile endpoints.
// DRY_RUN behavior: when no channel access token is configured, replies are
// logged instead of sent, so the Worker still runs end-to-end without secrets.

const LINE_API_BASE = "https://api.line.me/v2/bot";
const MAX_MESSAGES_PER_REPLY = 5; // LINE Messaging API hard limit per reply call.

/**
 * Sends a reply. Never sends empty-text messages (LINE returns 400 for those);
 * empty/blank entries in `texts` are dropped. If nothing is left to send,
 * this is a no-op (logged).
 *
 * @param {object} env - Worker env bindings
 * @param {string} replyToken
 * @param {string[]} texts
 * @param {typeof fetch} [fetchImpl]
 */
export async function replyText(env, replyToken, texts, fetchImpl = fetch) {
  const messages = (texts || [])
    .map((t) => (t ?? "").trim())
    .filter((t) => t.length > 0)
    .slice(0, MAX_MESSAGES_PER_REPLY)
    .map((text) => ({ type: "text", text }));

  if (messages.length === 0) {
    console.log("[line] skip reply: no non-empty text to send", { replyToken });
    return { skipped: true };
  }

  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.log("[line] DRY_RUN reply (no LINE_CHANNEL_ACCESS_TOKEN)", {
      replyToken,
      messageCount: messages.length,
      charLengths: messages.map((m) => m.text.length),
    });
    return { dryRun: true, messages };
  }

  const res = await fetchImpl(`${LINE_API_BASE}/message/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LINE reply API error ${res.status}: ${body.slice(0, 300)}`);
  }
  return { sent: true, messages };
}

/**
 * Best-effort display name lookup; falls back to null when no token is
 * configured or the lookup fails (caller should fall back to a userId-based
 * label in that case).
 *
 * @param {object} env
 * @param {{type: string, groupId?: string, roomId?: string, userId?: string}} source
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string | null>}
 */
export async function getDisplayName(env, source, fetchImpl = fetch) {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !source?.userId) return null;

  let url;
  if (source.type === "group" && source.groupId) {
    url = `${LINE_API_BASE}/group/${source.groupId}/member/${source.userId}`;
  } else if (source.type === "room" && source.roomId) {
    url = `${LINE_API_BASE}/room/${source.roomId}/member/${source.userId}`;
  } else {
    url = `${LINE_API_BASE}/profile/${source.userId}`;
  }

  try {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.displayName === "string" ? data.displayName : null;
  } catch (err) {
    console.log("[line] getDisplayName failed", String(err));
    return null;
  }
}

/**
 * Fictional-safe fallback label: last 6 chars of the userId, never the raw
 * full id, never a real name unless fetched via the API above.
 * @param {string} userId
 */
export function fallbackSpeakerLabel(userId) {
  if (!userId) return "unknown";
  return `user-${userId.slice(-6)}`;
}
