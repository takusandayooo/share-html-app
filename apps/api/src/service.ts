import type { Share, ShareViews } from "@share/contracts";
import {
  createShareSchema,
  sharingSchema,
  updateShareContentSchema,
} from "@share/contracts";
import { and, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { AppError, allowedEmail, config, type Env } from "./config";
import {
  CONTENT_ENCODING,
  contentKey,
  decryptContent,
  encryptContent,
} from "./content-crypto";
import { shares } from "./schema";
export const DAY = 86400000;
export async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function expiry(
  createdAt: number,
  days: number,
  min: number,
  max: number,
) {
  if (!Number.isInteger(days) || days < min || days > max || max > 30)
    throw new AppError(
      400,
      "INVALID_EXPIRY",
      "公開期間は許可された日数で指定してください。",
    );
  return createdAt + days * DAY;
}
export function fileKind(filename: string): "html" | "markdown" {
  if (
    /[\\/]/.test(filename) ||
    Array.from(filename).some((char) => char.charCodeAt(0) < 32)
  )
    throw new AppError(400, "INVALID_FILE", "ファイル名が不正です。");
  if (/\.html?$/i.test(filename)) return "html";
  if (/\.(md|markdown)$/i.test(filename)) return "markdown";
  throw new AppError(
    400,
    "INVALID_FILE",
    "HTMLまたはMarkdownを選択してください。",
  );
}
export class ShareService {
  db;
  cfg;
  constructor(public env: Env) {
    this.db = drizzle(env.DB);
    this.cfg = config(env);
  }
  view(row: typeof shares.$inferSelect, includeRecipients = true): Share {
    return {
      id: row.id,
      audience: row.audience,
      ...(includeRecipients ? { recipients: row.recipients } : {}),
      title: row.title,
      filename: row.filename,
      kind: row.kind,
      size: row.size,
      created_at: new Date(row.createdAt).toISOString(),
      updated_at: new Date(row.updatedAt ?? row.createdAt).toISOString(),
      expires_at: new Date(
        Math.min(row.expiresAt, row.createdAt + this.cfg.maxExpiryDays * DAY),
      ).toISOString(),
      url: `${this.cfg.baseUrl}/p/${row.id}`,
    };
  }
  async create(ownerId: string, input: unknown) {
    const parsed = createShareSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError(400, "INVALID_INPUT", "入力内容が不正です。");
    const data = parsed.data;
    const sharing = this.validateSharing(data);
    const kind = fileKind(data.filename);
    const size = new TextEncoder().encode(data.content).byteLength;
    if (size > this.cfg.maxFileBytes)
      throw new AppError(
        413,
        "FILE_TOO_LARGE",
        "ファイル容量が上限を超えています。",
      );
    if (data.content.includes("\u0000"))
      throw new AppError(
        400,
        "INVALID_ENCODING",
        "UTF-8のテキストを指定してください。",
      );
    const now = Date.now();
    const expiresAt = expiry(
      now,
      data.expires_in_days ?? this.cfg.defaultExpiryDays,
      this.cfg.minExpiryDays,
      this.cfg.maxExpiryDays,
    );
    const title = data.title ?? data.filename;
    const digest = await sha256(
      JSON.stringify([
        data.filename,
        data.content,
        title,
        data.expires_in_days ?? this.cfg.defaultExpiryDays,
        ...(sharing.audience !== "university" ? [sharing] : []),
      ]),
    );
    const existing = await this.db
      .select()
      .from(shares)
      .where(
        and(
          eq(shares.ownerId, ownerId),
          eq(shares.idempotencyKey, data.idempotency_key),
        ),
      )
      .get();
    if (existing) {
      if (existing.digest !== digest)
        throw new AppError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "同じキーで異なる内容は作成できません。",
        );
      if (
        existing.status !== "active" ||
        now >=
          Math.min(
            existing.expiresAt,
            existing.createdAt + this.cfg.maxExpiryDays * DAY,
          )
      )
        throw new AppError(
          409,
          "NOT_ACTIVE",
          "このリクエストは処理中または失効しています。",
        );
      return this.view(existing);
    }
    const id = crypto.randomUUID();
    const key = await contentKey(this.env.CONTENT_ENCRYPTION_KEY);
    const encrypted = await encryptContent(key, id, data.content);
    // The quota reservation and insert are a single SQLite statement, including pending uploads.
    const result =
      await this.env.DB.prepare(`INSERT INTO shares (id,owner_id,title,filename,kind,size,created_at,expires_at,status,idempotency_key,digest,audience,recipients)
    SELECT ?,?,?,?,?,?,?,?, 'pending',?,?,?,? WHERE (SELECT COUNT(*) FROM shares WHERE owner_id=? AND status IN ('active','pending') AND expires_at>?) < ? ON CONFLICT(owner_id,idempotency_key) DO NOTHING`)
        .bind(
          id,
          ownerId,
          title,
          data.filename,
          kind,
          size,
          now,
          expiresAt,
          data.idempotency_key,
          digest,
          sharing.audience,
          JSON.stringify(sharing.recipients),
          ownerId,
          now,
          this.cfg.maxActiveShares,
        )
        .run();
    if (!result.meta.changes)
      throw new AppError(
        409,
        "QUOTA_OR_DUPLICATE",
        "共有の上限に達したか、同じリクエストが処理中です。",
      );
    try {
      await this.env.DB.batch([
        this.env.DB.prepare(
          "INSERT INTO share_contents(share_id,content,encoding) VALUES(?,?,?)",
        ).bind(id, encrypted, CONTENT_ENCODING),
        this.env.DB.prepare(
          "UPDATE shares SET status='active' WHERE id=? AND status='pending'",
        ).bind(id),
      ]);
      const updated = await this.db
        .select()
        .from(shares)
        .where(and(eq(shares.id, id), eq(shares.status, "active")))
        .get();
      if (!updated)
        throw new AppError(
          409,
          "UPLOAD_CANCELLED",
          "アップロードが取り消されました。",
        );
      return this.view(updated);
    } catch (error) {
      await this.db
        .update(shares)
        .set({ status: "deleting" })
        .where(eq(shares.id, id));
      try {
        await this.purge(id);
      } catch {
        /* Cron retries storage failures. */
      }
      throw error;
    }
  }
  async find(id: string, ownerId?: string) {
    const row = await this.db
      .select()
      .from(shares)
      .where(
        ownerId
          ? and(eq(shares.id, id), eq(shares.ownerId, ownerId))
          : eq(shares.id, id),
      )
      .get();
    if (!row)
      throw new AppError(404, "NOT_FOUND", "共有ページが見つかりません。");
    if (
      row.status !== "active" ||
      Date.now() >=
        Math.min(row.expiresAt, row.createdAt + this.cfg.maxExpiryDays * DAY)
    )
      throw new AppError(410, "EXPIRED", "この共有ページは失効しています。");
    return row;
  }
  async getContent(ownerId: string, id: string) {
    await this.find(id, ownerId);
    const content = await this.readContent(id);
    const row = await this.find(id, ownerId);
    return { ...this.view(row), content };
  }
  async updateContent(ownerId: string, id: string, input: unknown) {
    const row = await this.find(id, ownerId);
    const parsed = updateShareContentSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError(400, "INVALID_INPUT", "入力内容が不正です。");
    const data = parsed.data;
    const filename = data.filename ?? row.filename;
    const kind = fileKind(filename);
    const size = new TextEncoder().encode(data.content).byteLength;
    if (size > this.cfg.maxFileBytes)
      throw new AppError(
        413,
        "FILE_TOO_LARGE",
        "ファイル容量が上限を超えています。",
      );
    if (data.content.includes("\u0000"))
      throw new AppError(
        400,
        "INVALID_ENCODING",
        "UTF-8のテキストを指定してください。",
      );
    const key = await contentKey(this.env.CONTENT_ENCRYPTION_KEY);
    const encrypted = await encryptContent(key, id, data.content);
    const now = Date.now();
    // D1 batches commit metadata and encrypted content atomically.
    // Recheck ownership and expiry after encryption completes.
    const eligible =
      "id=? AND owner_id=? AND status='active' AND expires_at>? AND created_at+?>?";
    const guard = [id, ownerId, now, this.cfg.maxExpiryDays * DAY, now];
    const results = await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE share_contents SET content=?,encoding=? WHERE share_id IN (SELECT id FROM shares WHERE ${eligible})`,
      ).bind(encrypted, CONTENT_ENCODING, ...guard),
      this.env.DB.prepare(
        `UPDATE shares SET title=?,filename=?,kind=?,size=?,updated_at=? WHERE ${eligible} AND EXISTS (SELECT 1 FROM share_contents WHERE share_id=shares.id) RETURNING id`,
      ).bind(data.title ?? row.title, filename, kind, size, now, ...guard),
    ]);
    if (!results[1].results.length)
      throw new AppError(
        409,
        "CONFLICT",
        "共有の状態が変わりました。再読み込みしてください。",
      );
    return this.view(await this.find(id, ownerId));
  }
  validateSharing(input: unknown) {
    const parsed = sharingSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError(400, "INVALID_SHARING", "共有先を確認してください。");
    const recipients = [...new Set(parsed.data.recipients)].sort();
    if (
      recipients.some(
        (email) => !allowedEmail(email, this.cfg.allowedEmailDomains),
      )
    )
      throw new AppError(
        400,
        "INVALID_RECIPIENT",
        "共有先には対象組織のメールを指定してください。",
      );
    if (parsed.data.audience === "selected" && !recipients.length)
      throw new AppError(
        400,
        "RECIPIENT_REQUIRED",
        "共有先を1人以上指定してください。",
      );
    if (parsed.data.audience !== "selected" && recipients.length)
      throw new AppError(
        400,
        "INVALID_SHARING",
        "メール指定以外の共有範囲では、共有先メールの指定は不要です。",
      );
    return { audience: parsed.data.audience, recipients };
  }
  async readable(id: string, viewer: { id?: string; email?: string }) {
    const row = await this.find(id);
    if (row.audience === "public") return row;
    if (!viewer.id || !viewer.email)
      throw new AppError(
        401,
        "LOGIN_REQUIRED",
        "所属組織のGoogleアカウントでログインしてください。",
      );
    if (
      row.ownerId !== viewer.id &&
      row.audience === "selected" &&
      !row.recipients.includes(viewer.email.toLowerCase())
    )
      throw new AppError(
        403,
        "SHARE_FORBIDDEN",
        "このページの共有先に含まれていません。投稿者に共有を依頼してください。",
      );
    return row;
  }
  async updateSharing(ownerId: string, id: string, input: unknown) {
    await this.find(id, ownerId);
    const sharing = this.validateSharing(input);
    const updated = await this.db
      .update(shares)
      .set(sharing)
      .where(
        and(
          eq(shares.id, id),
          eq(shares.ownerId, ownerId),
          eq(shares.status, "active"),
          gt(shares.expiresAt, Date.now()),
        ),
      )
      .returning()
      .get();
    if (!updated)
      throw new AppError(
        409,
        "CONFLICT",
        "共有の状態が変わりました。再読み込みしてください。",
      );
    return this.view(updated);
  }
  async list(
    ownerId: string,
    cursor?: string,
    limit = 30,
    recipientEmail?: string,
  ) {
    let before = Date.now() + 1;
    let lastId = "";
    if (cursor) {
      const match = cursor.match(/^(\d+):([0-9a-f-]{36})$/);
      if (!match || !Number.isSafeInteger(Number(match[1])))
        throw new AppError(400, "INVALID_CURSOR", "カーソルが不正です。");
      before = Number(match[1]);
      lastId = match[2];
    }
    const rows = await this.db
      .select()
      .from(shares)
      .where(
        and(
          recipientEmail
            ? and(
                sql`${shares.ownerId} <> ${ownerId}`,
                eq(shares.audience, "selected"),
                sql`EXISTS (SELECT 1 FROM json_each(${shares.recipients}) WHERE value = ${recipientEmail.toLowerCase()})`,
              )
            : eq(shares.ownerId, ownerId),
          eq(shares.status, "active"),
          gt(shares.expiresAt, Date.now()),
          gt(
            sql`${shares.createdAt}+${this.cfg.maxExpiryDays * DAY}`,
            Date.now(),
          ),
          or(
            lt(shares.createdAt, before),
            and(eq(shares.createdAt, before), lt(shares.id, lastId)),
          ),
        ),
      )
      .orderBy(desc(shares.createdAt), desc(shares.id))
      .limit(limit + 1);
    return {
      items: rows.slice(0, limit).map((r) => this.view(r, !recipientEmail)),
      next_cursor:
        rows.length > limit
          ? `${rows[limit - 1].createdAt}:${rows[limit - 1].id}`
          : null,
    };
  }
  async updateExpiry(ownerId: string, id: string, iso: string) {
    const row = await this.find(id, ownerId);
    const next = Date.parse(iso);
    const now = Date.now();
    if (
      !Number.isFinite(next) ||
      next <= now ||
      next > row.createdAt + this.cfg.maxExpiryDays * DAY
    )
      throw new AppError(
        400,
        "INVALID_EXPIRY",
        "失効日時は未来かつ作成日から最大期間以内で指定してください。",
      );
    const updated = await this.db
      .update(shares)
      .set({ expiresAt: next })
      .where(
        and(
          eq(shares.id, id),
          eq(shares.ownerId, ownerId),
          eq(shares.status, "active"),
          gt(shares.expiresAt, now),
        ),
      )
      .returning()
      .get();
    if (!updated)
      throw new AppError(
        409,
        "CONFLICT",
        "共有の状態が変わりました。再読み込みしてください。",
      );
    return this.view(updated);
  }
  async delete(ownerId: string, id: string) {
    const row = await this.db
      .update(shares)
      .set({ status: "deleting" })
      .where(and(eq(shares.id, id), eq(shares.ownerId, ownerId)))
      .returning()
      .get();
    if (!row) throw new AppError(404, "NOT_FOUND", "共有が見つかりません。");
    try {
      await this.purge(row.id);
    } catch {
      /* Access is already revoked; cron retries. */
    }
    return { deleted: true };
  }
  async readContent(id: string, viewer?: { id: string; email: string }) {
    if (viewer) await this.readable(id, viewer);
    else await this.find(id);
    const row = await this.env.DB.prepare(
      "SELECT content,encoding FROM share_contents WHERE share_id=?",
    )
      .bind(id)
      .first<{ content: string; encoding: string }>();
    if (viewer) await this.readable(id, viewer);
    else await this.find(id);
    if (!row) throw new AppError(404, "NOT_FOUND", "本文が見つかりません。");
    const key = await contentKey(this.env.CONTENT_ENCRYPTION_KEY);
    let content: string;
    if (row.encoding === CONTENT_ENCODING) {
      content = await decryptContent(key, id, row.content);
    } else if (row.encoding === "plaintext") {
      // Upgrade pre-encryption rows before returning them; no plaintext writes.
      content = row.content;
      await this.encryptLegacyRow(key, id, content);
    } else {
      throw new Error("Unsupported content encoding");
    }
    if (viewer) await this.readable(id, viewer);
    else await this.find(id);
    return content;
  }
  private async encryptLegacyRow(
    key: CryptoKey,
    id: string,
    plaintext: string,
  ) {
    const encrypted = await encryptContent(key, id, plaintext);
    await this.env.DB.prepare(
      "UPDATE share_contents SET content=?,encoding=? WHERE share_id=? AND encoding='plaintext'",
    )
      .bind(encrypted, CONTENT_ENCODING, id)
      .run();
  }
  async encryptLegacyContents() {
    const key = await contentKey(this.env.CONTENT_ENCRYPTION_KEY);
    // Bound memory and D1 subrequests, including on the free plan.
    const rows = await this.env.DB.prepare(
      "SELECT share_id,content FROM share_contents WHERE encoding='plaintext' LIMIT 1",
    ).all<{ share_id: string; content: string }>();
    for (const row of rows.results)
      await this.encryptLegacyRow(key, row.share_id, row.content);
    return rows.results.length;
  }
  async recordAccess(
    id: string,
    viewer: { id?: string; email?: string },
    kind: "view" | "download",
  ) {
    const share = await this.readable(id, viewer);
    if (viewer.id === share.ownerId) return;
    const now = Date.now();
    try {
      await this.env.DB.prepare(`INSERT INTO share_views(share_id,viewer_key,user_id,views,downloads,first_seen_at,last_seen_at)
        SELECT id,?,?,?,?,?,? FROM shares WHERE id=? AND status='active' AND expires_at>? AND created_at+?>?
        ON CONFLICT(share_id,viewer_key) DO UPDATE SET views=views+excluded.views,downloads=downloads+excluded.downloads,last_seen_at=excluded.last_seen_at`)
        .bind(
          viewer.id ? `user:${viewer.id}` : "anonymous",
          viewer.id ?? null,
          kind === "view" ? 1 : 0,
          kind === "download" ? 1 : 0,
          now,
          now,
          id,
          now,
          this.cfg.maxExpiryDays * DAY,
          now,
        )
        .run();
    } catch (error) {
      // An analytics storage failure must not break otherwise authorized viewing.
      console.warn("view_record_failed", {
        type: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  async accessHistory(
    ownerId: string,
    id: string,
    offset = 0,
  ): Promise<ShareViews> {
    await this.find(id, ownerId);
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000000)
      throw new AppError(400, "INVALID_INPUT", "履歴の取得条件が不正です。");
    const totals = await this.env.DB.prepare(
      `SELECT COALESCE(SUM(views),0) AS total_views, COALESCE(SUM(downloads),0) AS total_downloads, COUNT(CASE WHEN viewer_key<>'anonymous' THEN 1 END) AS signed_in_viewers FROM share_views WHERE share_id=?`,
    )
      .bind(id)
      .first<{
        total_views: number;
        total_downloads: number;
        signed_in_viewers: number;
      }>();
    const rows = await this.env.DB.prepare(
      `SELECT v.viewer_key,v.views,v.downloads,v.first_seen_at,v.last_seen_at,u.name,u.email FROM share_views v LEFT JOIN user u ON u.id=v.user_id WHERE v.share_id=? ORDER BY v.last_seen_at DESC,v.viewer_key LIMIT 51 OFFSET ?`,
    )
      .bind(id, offset)
      .all<{
        viewer_key: string;
        views: number;
        downloads: number;
        first_seen_at: number;
        last_seen_at: number;
        name: string | null;
        email: string | null;
      }>();
    return {
      total_views: totals?.total_views ?? 0,
      total_downloads: totals?.total_downloads ?? 0,
      signed_in_viewers: totals?.signed_in_viewers ?? 0,
      items: rows.results.slice(0, 50).map((row) => ({
        id: row.viewer_key,
        name:
          row.viewer_key === "anonymous"
            ? "匿名の閲覧"
            : (row.name ?? "削除されたアカウント"),
        email: row.email,
        anonymous: row.viewer_key === "anonymous",
        views: row.views,
        downloads: row.downloads,
        first_seen_at: new Date(row.first_seen_at).toISOString(),
        last_seen_at: new Date(row.last_seen_at).toISOString(),
      })),
      next_offset: rows.results.length > 50 ? offset + 50 : null,
    };
  }
  async purge(id: string) {
    // Content is deleted atomically by the foreign-key cascade.
    await this.db
      .delete(shares)
      .where(and(eq(shares.id, id), eq(shares.status, "deleting")));
  }
  async cleanup() {
    const now = Date.now();
    const removed = await this.env.DB.prepare(
      `DELETE FROM shares WHERE id IN (SELECT id FROM shares WHERE status='deleting' OR (status='active' AND (expires_at<=? OR created_at+?<=?)) OR (status='pending' AND created_at<?) LIMIT 100) RETURNING id`,
    )
      .bind(now, this.cfg.maxExpiryDays * DAY, now, now - 15 * 60000)
      .all<{ id: string }>();
    await this.env.DB.batch([
      this.env.DB.prepare("DELETE FROM api_keys WHERE expires_at<=?").bind(now),
      this.env.DB.prepare("DELETE FROM rate_limits WHERE window_start<?").bind(
        now - 3600000,
      ),
      this.env.DB.prepare("DELETE FROM session WHERE expiresAt<=?").bind(now),
      this.env.DB.prepare("DELETE FROM verification WHERE expiresAt<=?").bind(
        now,
      ),
    ]);
    return { processed: removed.results.length, failed: 0 };
  }
}
