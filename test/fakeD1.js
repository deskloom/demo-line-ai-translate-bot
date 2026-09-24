// Minimal in-memory fake of the D1Database interface used by src/db.js:
// prepare(sql).bind(...args).run() / .all() / .first()
// Supports exactly the queries used in this project (see src/db.js).

export function createFakeD1() {
  /** @type {Array<{id:string, source_id:string, speaker_label:string, lang:string, text:string, translation:string|null, created_at:number}>} */
  const rows = [];

  return {
    _rows: rows,
    prepare(sql) {
      return new FakeStatement(sql, rows);
    },
  };
}

class FakeStatement {
  constructor(sql, rows) {
    this.sql = sql.trim();
    this.rows = rows;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO messages")) {
      const [id, source_id, speaker_label, lang, text, translation, created_at] = this.args;
      this.rows.push({ id, source_id, speaker_label, lang, text, translation, created_at });
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith("DELETE FROM messages")) {
      const [cutoff] = this.args;
      const before = this.rows.length;
      const kept = this.rows.filter((r) => r.created_at >= cutoff);
      const removed = before - kept.length;
      this.rows.length = 0;
      this.rows.push(...kept);
      return { success: true, meta: { changes: removed } };
    }
    throw new Error(`FakeD1: unsupported run() sql: ${this.sql}`);
  }

  async all() {
    if (this.sql.startsWith("SELECT speaker_label")) {
      const [sourceId, since, limit] = this.args;
      const results = this.rows
        .filter((r) => r.source_id === sourceId && r.created_at >= since)
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, limit);
      return { results };
    }
    throw new Error(`FakeD1: unsupported all() sql: ${this.sql}`);
  }

  async first() {
    const { results } = await this.all();
    return results[0] ?? null;
  }
}
