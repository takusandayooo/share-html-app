"use client";
import type { Share, ShareViews } from "@share/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  audienceLabel,
  recipientEmails,
  SharingFields,
} from "@/components/sharing";
import { LoginPanel, useConfig } from "@/components/shell";
import { api, authClient, datetime, remaining } from "@/lib/client";
export default function MyShares() {
  const { data: session, isPending } = authClient.useSession();
  const { config } = useConfig();
  const [items, setItems] = useState<Share[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyShare, setHistoryShare] = useState<Share | null>(null);
  const [history, setHistory] = useState<ShareViews | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [sharing, setSharing] = useState<Share | null>(null);
  const [audience, setAudience] = useState<Share["audience"]>("university");
  const [recipients, setRecipients] = useState("");
  const [editing, setEditing] = useState<Share | null>(null);
  const [days, setDays] = useState(14);
  const [deleting, setDeleting] = useState<Share | null>(null);
  const [notice, setNotice] = useState("");
  const load = useCallback(async (next?: string) => {
    setBusy(true);
    try {
      const result = await api<{ items: Share[]; next_cursor: string | null }>(
        `/shares${next ? `?cursor=${encodeURIComponent(next)}` : ""}`,
      );
      setItems((old) => (next ? [...old, ...result.items] : result.items));
      setCursor(result.next_cursor);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得できませんでした。");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (session) void load();
  }, [session, load]);
  const change = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const at = new Date(
        Date.parse(editing.created_at) + days * 86400000,
      ).toISOString();
      await api(`/shares/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ expires_at: at }),
      });
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "変更できませんでした。");
    } finally {
      setBusy(false);
    }
  };
  const loadHistory = async (item: Share, offset = 0) => {
    setHistoryShare(item);
    setHistoryBusy(true);
    setError("");
    if (!offset) setHistory(null);
    try {
      const data = await api<ShareViews>(
        `/shares/${item.id}/views?offset=${offset}`,
      );
      setHistory((old) =>
        offset && old
          ? { ...data, items: [...old.items, ...data.items] }
          : data,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "履歴を取得できませんでした。");
    } finally {
      setHistoryBusy(false);
    }
  };
  const changeSharing = async () => {
    if (!sharing) return;
    setBusy(true);
    setError("");
    try {
      await api(`/shares/${sharing.id}/sharing`, {
        method: "PATCH",
        body: JSON.stringify({
          audience,
          recipients:
            audience === "selected" ? recipientEmails(recipients) : [],
        }),
      });
      setSharing(null);
      setNotice("共有先を変更しました。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "変更できませんでした。");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/shares/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除できませんでした。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR SHARED PAGES</span>
          <h1>マイページ</h1>
          <p>共有したページの共有先・期限・URLを、ここで管理。</p>
        </div>
        <Link href="/upload" className="button primary">
          ＋ 新しく共有する
        </Link>
      </div>
      {isPending ? (
        <p>読み込み中…</p>
      ) : !session ? (
        <LoginPanel />
      ) : (
        <>
          <section className="table-card">
            <div className="section-row">
              <h2>有効な共有</h2>
              <span className="count">{items.length}件</span>
            </div>
            {items.length === 0 && !busy ? (
              <div className="empty">
                <span className="file-symbol">&lt;/&gt;</span>
                <h3>まだ共有したページがありません</h3>
                <p>HTMLやMarkdownをアップロードしてみましょう。</p>
                <Link className="button secondary" href="/upload">
                  ファイルを共有する
                </Link>
              </div>
            ) : (
              <div className="share-list">
                {items.map((item) => (
                  <article key={item.id} className="share-row">
                    <span className="type-chip">
                      {item.kind === "html" ? "HTML" : "MD"}
                    </span>
                    <div className="share-details">
                      <Link href={`/p/${item.id}`}>
                        <strong>{item.title}</strong>
                      </Link>
                      <small>
                        {item.filename} · {audienceLabel(item.audience)} ·{" "}
                        {datetime(item.created_at)}作成
                      </small>
                    </div>
                    <div className="share-expiry">
                      <span className="pill">{remaining(item.expires_at)}</span>
                      <small>{datetime(item.expires_at)}まで</small>
                    </div>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button secondary"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(item.url);
                            setNotice("URLをコピーしました。");
                          } catch {
                            setNotice(item.url);
                          }
                        }}
                      >
                        URLコピー
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setEditing(item);
                          setDays(
                            Math.ceil(
                              (Date.parse(item.expires_at) -
                                Date.parse(item.created_at)) /
                                86400000,
                            ),
                          );
                          setError("");
                        }}
                      >
                        期限変更
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setSharing(item);
                          setAudience(item.audience);
                          setRecipients((item.recipients ?? []).join("\n"));
                          setEditing(null);
                          setError("");
                        }}
                      >
                        共有先変更
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={historyBusy}
                        onClick={() => loadHistory(item)}
                      >
                        閲覧履歴
                      </button>
                      <button
                        type="button"
                        className="text-button danger"
                        onClick={() => {
                          setDeleting(item);
                          setError("");
                        }}
                      >
                        削除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {cursor && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => load(cursor)}
              >
                さらに表示
              </button>
            )}
          </section>
          {historyShare && (
            <section className="edit-panel view-history">
              <div className="section-row">
                <h3>「{historyShare.title}」の閲覧履歴</h3>
                <div className="actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={historyBusy}
                    onClick={() => loadHistory(historyShare)}
                  >
                    更新
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={historyBusy}
                    onClick={() => {
                      setHistoryShare(null);
                      setHistory(null);
                    }}
                  >
                    閉じる
                  </button>
                </div>
              </div>
              <p>
                この機能の追加後から記録します。あなた自身のアクセスは含めません。匿名アクセスの人物は特定できません。
              </p>
              {history && (
                <>
                  <div className="history-totals">
                    <span>
                      閲覧 <strong>{history.total_views}</strong> 回
                    </span>
                    <span>
                      ダウンロード <strong>{history.total_downloads}</strong> 回
                    </span>
                    <span>
                      ログイン済み <strong>{history.signed_in_viewers}</strong>{" "}
                      人
                    </span>
                  </div>
                  {history.items.length ? (
                    <div className="history-list">
                      {history.items.map((item) => (
                        <article key={item.id} className="history-row">
                          <div>
                            <strong>{item.name}</strong>
                            {item.email && <small>{item.email}</small>}
                            <small>
                              最終アクセス：{datetime(item.last_seen_at)}
                            </small>
                          </div>
                          <span>
                            閲覧 {item.views} 回 · DL {item.downloads} 回
                          </span>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p>まだ閲覧履歴がありません。</p>
                  )}
                  {history.next_offset !== null && (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={historyBusy}
                      onClick={() =>
                        loadHistory(historyShare, history.next_offset ?? 0)
                      }
                    >
                      さらに表示
                    </button>
                  )}
                </>
              )}
              {historyBusy && <p role="status">履歴を読み込み中…</p>}
            </section>
          )}
          {sharing && (
            <section className="edit-panel">
              <h3>「{sharing.title}」の共有先変更</h3>
              <SharingFields
                audience={audience}
                recipients={recipients}
                onAudience={setAudience}
                onRecipients={setRecipients}
                disabled={busy}
              />
              <p>
                変更は保存後のアクセスから反映されます。閲覧者がすでに保存した内容は回収できません。
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={changeSharing}
                >
                  共有先を保存
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setSharing(null)}
                >
                  キャンセル
                </button>
              </div>
            </section>
          )}
          {editing && (
            <section className="edit-panel">
              <h3>「{editing.title}」の期限変更</h3>
              <p>
                作成日からの合計期間を指定します。最大
                {config?.maxExpiryDays ?? 30}日です。
              </p>
              <label>
                公開期間
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  {Array.from(
                    { length: config?.maxExpiryDays ?? 30 },
                    (_, i) => i + 1,
                  )
                    .filter(
                      (d) =>
                        Date.parse(editing.created_at) + d * 86400000 >
                        Date.now(),
                    )
                    .map((d) => (
                      <option key={d} value={d}>
                        {d}日間
                      </option>
                    ))}
                </select>
              </label>
              <div className="actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={change}
                  disabled={busy}
                >
                  変更する
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setEditing(null)}
                >
                  キャンセル
                </button>
              </div>
            </section>
          )}
          {deleting && (
            <section className="edit-panel">
              <h3>「{deleting.title}」を削除しますか？</h3>
              <p>共有URLはすぐに閲覧できなくなります。元に戻せません。</p>
              <div className="actions">
                <button
                  type="button"
                  className="button destructive"
                  disabled={busy}
                  onClick={remove}
                >
                  削除する
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setDeleting(null)}
                >
                  キャンセル
                </button>
              </div>
            </section>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
        </>
      )}
    </div>
  );
}
