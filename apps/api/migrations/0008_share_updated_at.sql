ALTER TABLE shares ADD COLUMN updated_at INTEGER;
UPDATE shares SET updated_at = created_at;
