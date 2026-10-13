ALTER TABLE audit_events ADD COLUMN actor_id TEXT;
CREATE INDEX audit_actor_time ON audit_events(actor_name,created_at);
CREATE TABLE IF NOT EXISTS dungeon_rollups (
  dungeon_id TEXT PRIMARY KEY,
  started INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  abandoned INTEGER NOT NULL DEFAULT 0,
  best_time_ms INTEGER
);
CREATE TRIGGER IF NOT EXISTS dungeon_start AFTER INSERT ON audit_events
WHEN NEW.kind='dungeon.start'
BEGIN
  INSERT INTO dungeon_rollups(dungeon_id,started)
  VALUES(json_extract(NEW.details_json,'$.dungeonId'),1)
  ON CONFLICT(dungeon_id) DO UPDATE SET started=started+1;
END;
CREATE TRIGGER IF NOT EXISTS dungeon_complete AFTER INSERT ON audit_events
WHEN NEW.kind='dungeon.complete'
BEGIN
  INSERT INTO dungeon_rollups(dungeon_id,completed,best_time_ms)
  VALUES(json_extract(NEW.details_json,'$.dungeonId'),1,CAST(json_extract(NEW.details_json,'$.durationMs') AS INTEGER))
  ON CONFLICT(dungeon_id) DO UPDATE SET completed=completed+1,
    best_time_ms=CASE WHEN excluded.best_time_ms>0 AND (best_time_ms IS NULL OR excluded.best_time_ms<best_time_ms) THEN excluded.best_time_ms ELSE best_time_ms END;
END;
CREATE TRIGGER IF NOT EXISTS dungeon_abandoned AFTER INSERT ON audit_events
WHEN NEW.kind='dungeon.abandoned'
BEGIN
  INSERT INTO dungeon_rollups(dungeon_id,abandoned)
  VALUES(json_extract(NEW.details_json,'$.dungeonId'),1)
  ON CONFLICT(dungeon_id) DO UPDATE SET abandoned=abandoned+1;
END;
