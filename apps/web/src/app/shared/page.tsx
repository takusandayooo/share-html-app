"use client";
import type { Share } from "@share/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LoginPanel } from "@/components/shell";
import { api, authClient, datetime } from "@/lib/client";
export default function SharedWithMe() {
  const { data: session, isPending } = authClient.useSession();
  const [items, setItems] = useState<Share[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async (next?: string) => {
    setBusy(true);
    try {
      const result = await api<{ items: Share[]; next_cursor: string | null }>(
        `/shared-with-me${next ? `?cursor=${encodeURIComponent(next)}` : ""}`,
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
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">SHARED WITH YOU</span>
          <h1>自分に共有されたページ</h1>
          <p>あなたの所属組織のメールを共有先に指定した、有効なページです。</p>
        </div>
      </div>
      {isPending ? (
        <p>読み込み中…</p>
      ) : !session ? (
        <LoginPanel />
      ) : (
        <section className="table-card">
          <div className="section-row">
            <h2>受け取った共有</h2>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => load()}
            >
              更新
            </button>
          </div>
          {!items.length && !busy && (
            <div className="empty">
              <h3>まだ共有されたページがありません</h3>
              <p>組織内のURL共有や全員公開のページは、共有URLから開けます。</p>
            </div>
          )}
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
                    {item.filename} · {datetime(item.expires_at)}まで
                  </small>
                </div>
                <Link className="button secondary" href={`/p/${item.id}`}>
                  開く →
                </Link>
              </article>
            ))}
          </div>
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
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
