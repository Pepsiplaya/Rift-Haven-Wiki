CREATE TABLE IF NOT EXISTS public_snapshots (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  category TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_name TEXT,
  details_json TEXT NOT NULL,
  outcome TEXT NOT NULL,
  delivered_at INTEGER,
  discord_message_id TEXT
);
CREATE INDEX IF NOT EXISTS audit_transaction ON audit_events(transaction_id);
CREATE INDEX IF NOT EXISTS audit_pending ON audit_events(delivered_at,created_at);
CREATE TABLE IF NOT EXISTS audit_cases (
  reference TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  opened_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL
);
