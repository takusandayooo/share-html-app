"use client";
import type { Share, ShareViews } from "@share/contracts";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { HtmlViewer } from "@/components/html-viewer";
import { audienceLabel } from "@/components/sharing";
import { LoginPanel } from "@/components/shell";
import { api, authClient, datetime, remaining } from "@/lib/client";

export default function SharedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: session, isPending } = authClient.useSession();
  const viewerId = session?.user.id ?? null;
  const [authReady, setAuthReady] = useState(!isPending);
  const [reloadVersion, setReloadVersion] = useState(0);
  // Focus refreshes can replace the session object (or briefly mark anonymous
  // sessions pending). Only identity changes should reload the sandboxed page.
  useEffect(() => {
    if (!isPending) setAuthReady(true);
  }, [isPending]);
  const viewer = useRef<HTMLDivElement>(null);
  const [controlsHidden, setControlsHidden] = useState(false);
  const [viewHistory, setViewHistory] = useState<ShareViews | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [share, setShare] = useState<Share | null>(null);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [expired, setExpired] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Identity changes revoke stale content; the retry counter explicitly restarts loading.
  useEffect(() => {
    if (!authReady) return;
    let live = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(
        new Error("読み込みがタイムアウトしました。もう一度お試しください。"),
      );
    }, 15000);
    setShare(null);
    setContent("");
    setError("");
    setExpired(false);
    setNeedsLogin(false);
    const load = async () => {
      const metadata = await fetch(`/api/shares/${id}`, {
        cache: "no-store",
        credentials: "include",
        signal: controller.signal,
      });
      if (!metadata.ok) {
        const data = await metadata.json();
        if (metadata.status === 401) {
          if (live) setNeedsLogin(true);
          return;
        }
        throw new Error(data.message || "共有ページを表示できません。");
      }
      const result = (await metadata.json()) as Share;
      const body = await fetch(`/api/shares/${id}/content`, {
        cache: "no-store",
        credentials: "include",
        signal: controller.signal,
      });
      if (!body.ok) {
        const data = await body.json();
        throw new Error(data.message || "本文を取得できません。");
      }
      const text = await body.text();
      if (live) {
        setShare(result);
        setContent(text);
      }
    };
    load()
      .catch((e: Error) => {
        if (live) setError(e.message);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      live = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [id, viewerId, authReady, reloadVersion]);
  useEffect(() => {
    setViewHistory(null);
    setHistoryError("");
    if (!share?.is_owner) return;
    let live = true;
    api<ShareViews>(`/shares/${share.id}/views`)
      .then((result) => {
        if (live) setViewHistory(result);
      })
      .catch(() => {
        if (live) setHistoryError("履歴を取得できませんでした。");
      });
    return () => {
      live = false;
    };
  }, [share]);
  useEffect(() => {
    if (!share) return;
    const interval = setInterval(() => {
      if (Date.now() >= Date.parse(share.expires_at)) {
        setExpired(true);
        setContent("");
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [share]);
  useEffect(() => {
    const change = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (immersive) {
      setImmersive(false);
      return;
    }
    if (viewer.current?.requestFullscreen) {
      try {
        await viewer.current.requestFullscreen();
        return;
      } catch {
        /* Some mobile browsers use the viewport fallback. */
      }
    }
    setImmersive(true);
  };
  if (!authReady)
    return <div className="page loading">ログイン状態を確認中…</div>;
  if (needsLogin)
    return (
      <div className="page">
        <LoginPanel />
      </div>
    );
  if (error || expired)
    return (
      <div className="page">
        <section className="empty table-card">
          <h1>このページは表示できません</h1>
          <p>{expired ? "公開期限が終了しました。" : error}</p>
          {!expired && (
            <button
              type="button"
              onClick={() => setReloadVersion((value) => value + 1)}
            >
              再読み込み
            </button>
          )}
        </section>
      </div>
    );
  if (!share)
    return <div className="page loading">共有ページを読み込み中…</div>;
  return (
    <div ref={viewer} className={`viewer-page ${immersive ? "immersive" : ""}`}>
      <div className="viewer-floating-controls">
        {!controlsHidden && (
          <>
            <details className="viewer-details">
              <summary
                className="viewer-icon"
                title={share.is_owner ? "閲覧者・ページ情報" : "ページ情報"}
                aria-label={
                  share.is_owner ? "閲覧者・ページ情報" : "ページ情報"
                }
              >
                {share.is_owner ? (
                  <>
                    ◉ <span>{viewHistory?.signed_in_viewers ?? "…"}</span>
                  </>
                ) : (
                  "ⓘ"
                )}
              </summary>
              <div className="viewer-detail-popover">
                <strong>
                  {share.is_owner
                    ? `閲覧した人 ${viewHistory?.signed_in_viewers ?? 0}人`
                    : share.title}
                </strong>
                {share.is_owner && (
                  <>
                    <p>
                      ログイン済みの大学利用者を記録します。あなた自身のアクセスは除きます。
                    </p>
                    {historyError && <p role="alert">{historyError}</p>}
                    <div className="viewer-readers">
                      {viewHistory?.items
                        .filter((item) => !item.anonymous)
                        .map((item) => (
                          <div key={item.id} className="viewer-reader">
                            <span className="reader-avatar">
                              {item.name.slice(0, 1)}
                            </span>
                            <div>
                              <strong>{item.name}</strong>
                              <small>{item.email}</small>
                              <small>{datetime(item.last_seen_at)}</small>
                            </div>
                          </div>
                        ))}
                      {viewHistory && !viewHistory.signed_in_viewers && (
                        <p>まだ他の人の閲覧はありません。</p>
                      )}
                    </div>
                    {viewHistory?.items.some((item) => item.anonymous) && (
                      <p>
                        匿名の閲覧：
                        {viewHistory.items.find((item) => item.anonymous)
                          ?.views ?? 0}
                        回（人物は特定できません）
                      </p>
                    )}
                    <Link href="/shares">マイページで履歴を見る →</Link>
                  </>
                )}
                <hr />
                <p>
                  {share.title} · {audienceLabel(share.audience)}
                </p>
                <p>
                  {datetime(share.expires_at)}まで ·{" "}
                  {remaining(share.expires_at)}
                </p>
                <p>
                  閲覧・ダウンロードを記録します。ログイン中は名前とメール、未ログインは匿名の件数のみが投稿者に表示されます。
                </p>
                <Link href={session ? "/shares" : "/"}>sharepagesに戻る</Link>
              </div>
            </details>
            <a
              className="viewer-icon"
              href={`/api/shares/${id}/download`}
              title="ダウンロード"
              aria-label="ダウンロード"
            >
              ↓
            </a>
            <button
              type="button"
              className="viewer-icon"
              title={fullscreen || immersive ? "全画面を終了" : "全画面"}
              aria-label={fullscreen || immersive ? "全画面を終了" : "全画面"}
              onClick={toggleFullscreen}
            >
              ⛶
            </button>
          </>
        )}
        <button
          type="button"
          className="viewer-icon"
          title={controlsHidden ? "操作を表示" : "操作を小さくする"}
          aria-label={controlsHidden ? "操作を表示" : "操作を小さくする"}
          onClick={() => setControlsHidden(!controlsHidden)}
        >
          {controlsHidden ? "+" : "−"}
        </button>
      </div>
      <div className="viewer-content">
        {share.kind === "html" ? (
          <HtmlViewer
            key={JSON.stringify([id, viewerId])}
            content={content}
            title={share.title}
            shareId={id}
            viewerId={viewerId}
          />
        ) : (
          <article className="markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSanitize]}
              components={{
                img: () => (
                  <span className="subtle">［画像参照は表示できません］</span>
                ),
                a: ({ children, href }) => (
                  <a href={href} rel="noopener noreferrer" target="_blank">
                    {children}
                  </a>
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          </article>
        )}
      </div>
    </div>
  );
}
