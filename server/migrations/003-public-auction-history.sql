CREATE INDEX IF NOT EXISTS audit_public_sales ON audit_events(kind,outcome,created_at);
