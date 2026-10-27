"use client";

import type { Share } from "@share/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { HtmlViewer } from "@/components/html-viewer";
import { LoginPanel, useConfig } from "@/components/shell";
import { api, authClient, datetime } from "@/lib/client";
import {
  editorKind,
  readReplacement,
  validateEditorContent,
} from "@/lib/share-editor";

export default function EditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: session, isPending } = authClient.useSession();
  const [authReady, setAuthReady] = useState(!isPending);
  useEffect(() => {
    if (!isPending) setAuthReady(true);
  }, [isPending]);
  if (!authReady)
    return <div className="page loading">ログイン状態を確認中…</div>;
  if (!session)
    return (
      <div className="page">
        <LoginPanel callbackURL={`/p/${id}/edit`} />
      </div>
    );
  return (
    <ShareEditor
      key={`${id}:${session.user.id}`}
      id={id}
      viewerId={session.user.id}
    />
  );
}

function ShareEditor({ id, viewerId }: { id: string; viewerId: string }) {
  const router = useRouter();
  const { config, error: configError } = useConfig();
  const [share, setShare] = useState<Share | null>(null);
  const [original, setOriginal] = useState({
    title: "",
    filename: "",
    content: "",
  });
  const [title, setTitle] = useState("");
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState(false);
  const [retry, setRetry] = useState(0);
  const dirty =
    title !== original.title ||
    filename !== original.filename ||
    content !== original.content;

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly restarts loading without discarding edits on focus refreshes.
  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    const load = async () => {
      const metadata = await api<Share>(`/shares/${id}`, {
        signal: controller.signal,
      });
      if (!metadata.is_owner)
        throw new Error("このページを編集できるのは投稿者だけです。");
      const response = await fetch(`/api/shares/${id}/content`, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          "本文を取得できません。ページを再読み込みしてください。",
        );
      const body = await response.text();
      if (controller.signal.aborted) return;
      const value = {
        title: metadata.title,
        filename: metadata.filename,
        content: body,
      };
      setShare(metadata);
      setOriginal(value);
      setTitle(value.title);
      setFilename(value.filename);
      setContent(value.content);
    };
    void load().catch((reason: Error) => {
      if (!controller.signal.aborted) setLoadError(reason.message);
    });
    return () => controller.abort();
  }, [id, retry]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const cancel = () => {
    if (dirty && !window.confirm("保存していない変更を破棄して戻りますか？"))
      return;
    router.push(`/p/${id}`);
  };
  const replace = async (file: File) => {
    if (!config) return;
    setReading(true);
    setError("");
    setNotice("");
    try {
      const value = await readReplacement(file, config.maxFileBytes);
      setFilename(value.filename);
      setContent(value.content);
      setPreview(false);
      setNotice(
        `${value.filename}を読み込みました。「変更を保存」でページに反映されます。`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "ファイルを読み込めませんでした。",
      );
    } finally {
      setReading(false);
    }
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!config || !share || busy || reading) return;
    setError("");
    setNotice("");
    try {
      editorKind(filename);
      validateEditorContent(content, config.maxFileBytes);
      if (!title.trim()) throw new Error("タイトルを入力してください。");
      setBusy(true);
      const updated = await api<Share>(`/shares/${id}/content`, {
        method: "PATCH",
        body: JSON.stringify({ title, filename, content }),
      });
      setShare({ ...updated, is_owner: true });
      setTitle(updated.title);
      setOriginal({
        title: updated.title,
        filename: updated.filename,
        content,
      });
      setNotice("変更を保存しました。同じURLで更新したページを閲覧できます。");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "保存できませんでした。もう一度お試しください。",
      );
    } finally {
      setBusy(false);
    }
  };
  let kind: "html" | "markdown" | null = null;
  try {
    kind = editorKind(filename);
  } catch {
    /* Show validation on preview/save. */
  }

  if (loadError)
    return (
      <div className="page">
        <section className="table-card empty">
          <h1>ページを編集できません</h1>
          <p role="alert">{loadError}</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => setRetry((value) => value + 1)}
          >
            再読み込み
          </button>
          <p>
            <Link href="/shares">マイページに戻る</Link>
          </p>
        </section>
      </div>
    );
  if (!share)
    return <div className="page loading">編集するページを読み込み中…</div>;
  return (
    <div className="page share-editor">
      <div className="page-heading">
        <div>
          <span className="eyebrow">EDIT PAGE</span>
          <h1>ページを編集</h1>
          <p>
            本文を直接書き換えるか、HTML・Markdownファイルを読み込んで差し替えられます。
          </p>
        </div>
      </div>
      <p className="subtle">
        同じURLで更新します。共有先・公開期限・閲覧履歴はそのままです。
      </p>
      <form onSubmit={save}>
        <fieldset className="editor-fields" disabled={busy || reading}>
          <div className="editor-metadata">
            <label>
              タイトル
              <input
                required
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              ファイル名
              <input
                required
                maxLength={200}
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
              />
              <small>.html / .htm / .md / .markdown</small>
            </label>
          </div>
          <div className="editor-file table-card">
            <label htmlFor="replacement-file">ファイルを差し替え</label>
            <p>
              選んだファイルの本文とファイル名を読み込みます。保存するまで公開ページには反映されません。
            </p>
            <input
              id="replacement-file"
              type="file"
              accept=".html,.htm,.md,.markdown"
              disabled={!config}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void replace(file);
              }}
            />
            <small>
              UTF-8形式・最大{" "}
              {config
                ? `${Math.floor(config.maxFileBytes / 1024)} KB`
                : "確認中…"}
            </small>
          </div>
          <fieldset className="editor-tabs" aria-label="本文の表示切り替え">
            <button
              type="button"
              className={`button ${preview ? "secondary" : "primary"}`}
              aria-pressed={!preview}
              onClick={() => setPreview(false)}
            >
              本文を編集
            </button>
            <button
              type="button"
              className={`button ${preview ? "primary" : "secondary"}`}
              aria-pressed={preview}
              onClick={() => setPreview(true)}
            >
              プレビュー
            </button>
          </fieldset>
          {preview ? (
            <section className="editor-preview" aria-label="保存前のプレビュー">
              {kind === "html" ? (
                <HtmlViewer
                  content={content}
                  title={title}
                  shareId={`${id}:editor-preview`}
                  viewerId={viewerId}
                />
              ) : kind === "markdown" ? (
                <article className="markdown">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeSanitize]}
                    components={{
                      img: () => (
                        <span className="subtle">
                          ［画像参照は表示できません］
                        </span>
                      ),
                      a: ({ children, href }) => (
                        <a
                          href={href}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {content}
                  </ReactMarkdown>
                </article>
              ) : (
                <p>
                  プレビューするにはHTMLまたはMarkdownのファイル名を指定してください。
                </p>
              )}
            </section>
          ) : (
            <label className="editor-source">
              本文（
              {kind === "html"
                ? "HTML"
                : kind === "markdown"
                  ? "Markdown"
                  : "テキスト"}
              ）
              <textarea
                required
                value={content}
                onChange={(event) => setContent(event.target.value)}
                spellCheck={false}
              />
            </label>
          )}
        </fieldset>
        {(error || configError) && (
          <p className="error" role="alert">
            {error || configError}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <div className="editor-actions">
          <button
            type="submit"
            className="button primary"
            disabled={!config || busy || reading || !dirty}
          >
            {busy ? "保存中…" : reading ? "ファイル読み込み中…" : "変更を保存"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy || reading}
            onClick={cancel}
          >
            {dirty ? "キャンセル" : "ページを見る"}
          </button>
          <span className="subtle">
            {dirty
              ? "未保存の変更があります"
              : `最終更新：${datetime(share.updated_at)}`}
          </span>
        </div>
      </form>
    </div>
  );
}
