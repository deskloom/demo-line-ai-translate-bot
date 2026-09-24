-- Portfolio demo schema. Fictional message data only.
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  speaker_label TEXT NOT NULL,
  lang TEXT NOT NULL,
  text TEXT NOT NULL,
  translation TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_source_created
  ON messages (source_id, created_at);
