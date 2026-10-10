CREATE TABLE shares (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 title TEXT NOT NULL, filename TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('html','markdown')),
 size INTEGER NOT NULL, object_key TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','active','deleting')), idempotency_key TEXT NOT NULL, digest TEXT NOT NULL,
 CHECK(expires_at > created_at AND expires_at <= created_at + 2592000000)
);
CREATE INDEX shares_owner ON shares(owner_id,created_at);
CREATE INDEX shares_expiry ON shares(status,expires_at);
CREATE UNIQUE INDEX shares_request ON shares(owner_id,idempotency_key);
CREATE TABLE api_keys (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 name TEXT NOT NULL, prefix TEXT NOT NULL, hash TEXT UNIQUE NOT NULL, scopes TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_used_at INTEGER
);
CREATE INDEX api_keys_owner ON api_keys(owner_id);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
