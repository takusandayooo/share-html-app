ALTER TABLE share_contents ADD COLUMN encoding TEXT NOT NULL DEFAULT 'plaintext'
  CHECK(encoding IN ('plaintext', 'aes-256-gcm-v1'));
CREATE INDEX share_contents_encoding ON share_contents(encoding);
