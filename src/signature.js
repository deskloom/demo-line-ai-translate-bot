// Verifies LINE's X-Line-Signature header: base64(HMAC-SHA256(channelSecret, rawBody)).
// Uses Web Crypto only (no npm deps) and a constant-time comparison.

/**
 * @param {string} rawBody - the exact raw request body bytes, as a string
 * @param {string | null} signatureHeader - the X-Line-Signature header value
 * @param {string} channelSecret
 * @returns {Promise<boolean>}
 */
export async function verifyLineSignature(rawBody, signatureHeader, channelSecret) {
  if (!signatureHeader || !channelSecret) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = base64Encode(new Uint8Array(mac));

  return constantTimeEqual(expected, signatureHeader);
}

function base64Encode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa is available in the Workers runtime.
  return btoa(binary);
}

/** Constant-time string comparison (length-independent early exit is avoided). */
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < maxLen; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}
