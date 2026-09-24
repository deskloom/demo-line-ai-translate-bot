// D1 access helpers. Only uses prepare().bind().run()/all()/first(), so the
// same code works against the real D1Database binding and the in-memory fake
// used in tests (see test/fakeD1.js).

/**
 * @param {D1Database} db
 * @param {{id: string, sourceId: string, speakerLabel: string, lang: string, text: string, translation: string|null, createdAt: number}} msg
 */
export async function insertMessage(db, msg) {
  await db
    .prepare(
      `INSERT INTO messages (id, source_id, speaker_label, lang, text, translation, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      msg.id,
      msg.sourceId,
      msg.speakerLabel,
      msg.lang,
      msg.text,
      msg.translation ?? null,
      msg.createdAt
    )
    .run();
}

/**
 * Returns the last `limit` messages for a source within `windowMs` of `nowMs`,
 * oldest first, for use as translation context.
 * @param {D1Database} db
 * @param {string} sourceId
 * @param {number} nowMs
 * @param {number} windowMs
 * @param {number} limit
 */
export async function getRecentContext(db, sourceId, nowMs, windowMs, limit) {
  const since = nowMs - windowMs;
  const res = await db
    .prepare(
      `SELECT speaker_label, lang, text, created_at FROM messages
       WHERE source_id = ? AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(sourceId, since, limit)
    .all();
  const rows = res.results ?? [];
  return rows
    .map((r) => ({
      speakerLabel: r.speaker_label,
      lang: r.lang,
      text: r.text,
      createdAt: r.created_at,
    }))
    .reverse(); // oldest first
}

/**
 * Deletes messages older than `cutoffMs`. Returns number of rows deleted
 * (fake D1 in tests reports meta.changes; real D1 does too).
 * @param {D1Database} db
 * @param {number} cutoffMs
 */
export async function deleteOlderThan(db, cutoffMs) {
  const res = await db.prepare(`DELETE FROM messages WHERE created_at < ?`).bind(cutoffMs).run();
  return res.meta?.changes ?? 0;
}
