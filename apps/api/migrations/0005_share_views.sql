CREATE TABLE share_views (
  share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  viewer_key TEXT NOT NULL,
  user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  views INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, viewer_key)
);
CREATE INDEX share_views_recent ON share_views(share_id, last_seen_at DESC);
