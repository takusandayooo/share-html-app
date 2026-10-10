import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
export const shares = sqliteTable(
  "shares",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    audience: text("audience", { enum: ["university", "selected", "public"] })
      .notNull()
      .default("university"),
    recipients: text("recipients", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    title: text("title").notNull(),
    filename: text("filename").notNull(),
    kind: text("kind", { enum: ["html", "markdown"] }).notNull(),
    size: integer("size").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    status: text("status", {
      enum: ["pending", "active", "deleting"],
    }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    digest: text("digest").notNull(),
  },
  (t) => [
    index("shares_owner").on(t.ownerId, t.createdAt),
    index("shares_expiry").on(t.status, t.expiresAt),
    uniqueIndex("shares_request").on(t.ownerId, t.idempotencyKey),
  ],
);
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull().unique(),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [index("api_keys_owner").on(t.ownerId)],
);

export const shareContents = sqliteTable("share_contents", {
  shareId: text("share_id")
    .primaryKey()
    .references(() => shares.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  encoding: text("encoding", { enum: ["plaintext", "aes-256-gcm-v1"] })
    .notNull()
    .default("plaintext"),
});

export const shareViews = sqliteTable(
  "share_views",
  {
    shareId: text("share_id")
      .notNull()
      .references(() => shares.id, { onDelete: "cascade" }),
    viewerKey: text("viewer_key").notNull(),
    userId: text("user_id"),
    views: integer("views").notNull().default(0),
    downloads: integer("downloads").notNull().default(0),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.shareId, t.viewerKey] }),
    index("share_views_recent").on(t.shareId, t.lastSeenAt),
  ],
);
