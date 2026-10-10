"use client";
import type { Share } from "@share/contracts";
import { useRef, useState } from "react";
import {
  audienceLabel,
  recipientEmails,
  SharingFields,
} from "@/components/sharing";
import { LoginPanel, useConfig } from "@/components/shell";
import { api, authClient, datetime } from "@/lib/client";
export default function Home() {
  const { data: session, isPending } = authClient.useSession();
  const { config, error: configError } = useConfig();
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState<Share["audience"]>("university");
  const [recipients, setRecipients] = useState("");
  const [days, setDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<
    Array<{ file: string; share?: Share; error?: string }>
  >([]);
  const input = useRef<HTMLInputElement>(null);
  const requestIds = useRef(new Map<string, string>());
  const select = (list: File[]) => {
    if (!config) return;
    if (list.length > config.maxBatchFiles) {
      setMessage(`一度に${config.maxBatchFiles}ファイルまで選択できます。`);
      return;
    }
    if (list.some((f) => !/\.(html?|md|markdown)$/i.test(f.name))) {
      setMessage("HTMLまたはMarkdownを選択してください。");
      return;
    }
    if (list.some((f) => f.size > config.maxFileBytes)) {
      setMessage("ファイル容量が上限を超えています。");
      return;
    }
    if (new Set(list.map((file) => file.name)).size !== list.length) {
      setMessage("同じ名前のファイルは一度に選択できません。");
      return;
    }
    setFiles(list);
    setResults([]);
    setMessage("");
  };
  const upload = async () => {
    if (!config) return;
    setBusy(true);
    setMessage("");
    const output: Array<{ file: string; share?: Share; error?: string }> = [];
    for (const file of files) {
      try {
        const bytes = await file.arrayBuffer();
        const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const share = await api<Share>("/shares", {
          method: "POST",
          body: JSON.stringify({
            audience,
            recipients:
              audience === "selected" ? recipientEmails(recipients) : [],
            filename: file.name,
            content,
            title: files.length === 1 && title ? title : undefined,
            expires_in_days: days ?? config.defaultExpiryDays,
            idempotency_key: (() => {
              const key = JSON.stringify([
                file.name,
                file.size,
                file.lastModified,
                title,
                audience,
                audience === "selected" ? recipientEmails(recipients) : [],
                days ?? config.defaultExpiryDays,
              ]);
              if (!requestIds.current.has(key))
                requestIds.current.set(key, crypto.randomUUID());
              return requestIds.current.get(key);
            })(),
          }),
        });
        output.push({ file: file.name, share });
      } catch (e) {
        output.push({
          file: file.name,
          error:
            e instanceof Error ? e.message : "アップロードに失敗しました。",
        });
      }
    }
    setResults(output);
    setBusy(false);
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("URLをコピーしました。");
    } catch {
      setMessage("コピーできませんでした。表示されたURLを選択してください。");
    }
  };
  return (
    <div className="page simple-upload">
      <div className="page-heading">
        <div>
          <h1>ファイルを共有</h1>
          <p>HTML / Markdownを選び、期限と共有先を設定します。</p>
        </div>
      </div>
      <div className="workspace">
        <section className="upload-card">
          <div className="card-heading">
            <div>
              <h2>アップロード</h2>
            </div>
            <span className="subtle">HTML / Markdown</span>
          </div>
          {isPending ? (
            <p className="loading">ログイン状態を確認中…</p>
          ) : !session ? (
            <LoginPanel />
          ) : (
            <>
              <button
                type="button"
                className={`dropzone ${drag ? "dragging" : ""}`}
                disabled={busy}
                onClick={() => input.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  select(Array.from(e.dataTransfer.files));
                }}
              >
                <span className="upload-symbol">↑</span>
                <strong>
                  {files.length
                    ? `${files.length}ファイルを選択しました`
                    : "ここにファイルをドロップ"}
                </strong>
                <span>またはクリックして選択</span>
                <small>
                  1ファイル最大{" "}
                  {Math.round((config?.maxFileBytes ?? 1048576) / 1048576)} MiB
                  · 一括{config?.maxBatchFiles ?? 5}ファイル
                </small>
              </button>
              <input
                ref={input}
                type="file"
                accept=".html,.htm,.md,.markdown"
                multiple
                hidden
                onChange={(e) => select(Array.from(e.target.files ?? []))}
              />
              {files.length > 0 && (
                <div className="file-list">
                  {files.map((f) => (
                    <div key={f.name + f.size}>
                      <span className="type-chip">
                        {f.name.endsWith(".md") ? "MD" : "HTML"}
                      </span>
                      <span>{f.name}</span>
                      <small>{(f.size / 1024).toFixed(1)} KB</small>
                    </div>
                  ))}
                </div>
              )}
              <div className="upload-options">
                <label>
                  タイトル
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="未入力の場合はファイル名"
                    maxLength={120}
                    disabled={files.length > 1}
                  />
                </label>
                <label>
                  公開期間
                  <select
                    value={days ?? config?.defaultExpiryDays ?? 14}
                    onChange={(e) => setDays(Number(e.target.value))}
                  >
                    {Array.from(
                      {
                        length:
                          (config?.maxExpiryDays ?? 30) -
                          (config?.minExpiryDays ?? 1) +
                          1,
                      },
                      (_, i) => i + (config?.minExpiryDays ?? 1),
                    ).map((d) => (
                      <option key={d} value={d}>
                        {d}日間
                        {d === (config?.defaultExpiryDays ?? 14)
                          ? "（標準）"
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <SharingFields
                audience={audience}
                recipients={recipients}
                onAudience={setAudience}
                onRecipients={setRecipients}
                disabled={busy}
              />
              <button
                type="button"
                className="button primary full"
                onClick={upload}
                disabled={busy || !files.length || !config}
              >
                {busy ? "共有URLを作成中…" : "共有URLを作成する →"}
              </button>
              <p className="hint">
                自己完結したUTF-8ファイルに対応。外部CDNや別ファイルの参照には対応していません。
              </p>
            </>
          )}
          {(message || configError) && (
            <p className={configError ? "error" : "notice"} role="status">
              {configError || message}
            </p>
          )}
          {results.length > 0 && (
            <div className="results">
              <div className="section-row">
                <h3>共有結果</h3>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    copy(
                      results
                        .flatMap((r) => (r.share ? [r.share.url] : []))
                        .join("\n"),
                    )
                  }
                >
                  URLをまとめてコピー
                </button>
              </div>
              {results.map((r) => (
                <div key={r.file} className="result">
                  <strong>{r.file}</strong>
                  {r.share ? (
                    <>
                      <a href={r.share.url}>{r.share.url}</a>
                      <small>
                        {audienceLabel(r.share.audience)} ·{" "}
                        {datetime(r.share.expires_at)}まで
                      </small>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => copy(r.share?.url ?? "")}
                      >
                        コピー
                      </button>
                    </>
                  ) : (
                    <p className="error">{r.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
