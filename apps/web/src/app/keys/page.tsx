"use client";
import type { ApiKey } from "@share/contracts";
import { keyScopes } from "@share/contracts";
import { useCallback, useEffect, useState } from "react";
import { OAuthConnections } from "@/components/oauth-connections";
import { OAuthSetupGuide } from "@/components/oauth-setup-guide";
import { LoginPanel, useConfig } from "@/components/shell";
import { api, authClient, datetime } from "@/lib/client";
import { installCommand, type McpClientId, mcpClients } from "@/lib/mcp-setup";
export default function Keys() {
  const { data: session, isPending } = authClient.useSession();
  const { config } = useConfig();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [client, setClient] = useState<McpClientId>("codex");
  const [os, setOs] = useState<"unix" | "windows">("unix");
  const [showToken, setShowToken] = useState(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState(30);
  const [scopes, setScopes] = useState<string[]>([...keyScopes]);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      const data = await api<{ items: ApiKey[] }>("/keys");
      setKeys(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得できませんでした。");
    }
  }, []);
  useEffect(() => {
    if (session) void load();
  }, [session, load]);
  const create = async () => {
    setBusy(true);
    setError("");
    setToken("");
    try {
      const data = await api<{ token: string }>("/keys", {
        method: "POST",
        body: JSON.stringify({
          name:
            name.trim() ||
            mcpClients.find((item) => item.id === client)?.name ||
            "MCP",
          expires_in_days: days,
          scopes,
        }),
      });
      setToken(data.token);
      setShowToken(false);
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "作成できませんでした。");
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await api(`/keys/${revoking.id}`, { method: "DELETE" });
      setRevoking(null);
      setToken("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "失効できませんでした。");
    } finally {
      setBusy(false);
    }
  };
  const mcpUrl = config?.mcpUrl ?? "";
  const selected =
    mcpClients.find((item) => item.id === client) ?? mcpClients[0];
  const command = mcpUrl
    ? installCommand(client, os, mcpUrl, "YOUR_API_KEY")
    : "接続先を読み込み中…";
  const copyCommand = async () => {
    if (!token || !mcpUrl) return;
    try {
      await navigator.clipboard.writeText(
        installCommand(client, os, mcpUrl, token),
      );
      setNotice(
        "キー入りの接続コマンドをコピーしました。選んだOSのターミナルで実行してください。",
      );
    } catch {
      setError(
        "コピーできませんでした。下の「キーを表示」からキーを保存し、手動設定してください。",
      );
    }
  };
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONNECT YOUR AI</span>
          <h1>MCP接続</h1>
          <p>通常はCodexを選び、APIキーで接続してください。</p>
        </div>
        <span className="campus-badge">個人APIキー</span>
      </div>
      {isPending ? (
        <p>読み込み中…</p>
      ) : !session ? (
        <LoginPanel />
      ) : (
        <>
          <section className="table-card mcp-setup-card">
            <h2>1. 接続するアプリを選ぶ</h2>
            <div className="mcp-client-picker">
              {mcpClients.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`button ${client === item.id ? "primary" : "secondary"}`}
                  aria-pressed={client === item.id}
                  onClick={() => setClient(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>
            <p className="hint">
              {selected.help}{" "}
              <a href={selected.docs} target="_blank" rel="noreferrer">
                公式設定手順 ↗
              </a>
            </p>
            <div className="mcp-os-picker">
              <button
                type="button"
                className={`button ${os === "unix" ? "primary" : "secondary"}`}
                aria-pressed={os === "unix"}
                onClick={() => setOs("unix")}
              >
                macOS / Linux
              </button>
              <button
                type="button"
                className={`button ${os === "windows" ? "primary" : "secondary"}`}
                aria-pressed={os === "windows"}
                onClick={() => setOs("windows")}
              >
                Windows（PowerShell）
              </button>
            </div>
            <h2>2. キーを発行してコマンドをコピー</h2>
            <p className="hint">
              ログイン中：{session.user.email} ·
              キーは標準30日間。再発行した場合は、新しいコマンドを実行してください。
            </p>
            <details className="mcp-advanced">
              <summary>キーの名前・期限・権限を変更</summary>
              <label>
                キーの名前
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={selected.name}
                  maxLength={60}
                />
              </label>
              <label>
                有効期間
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  {[7, 14, 30, 60, 90].map((d) => (
                    <option key={d} value={d}>
                      {d}日間
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>許可する操作</legend>
                {keyScopes.map((scope) => (
                  <label className="checkbox" key={scope}>
                    <input
                      type="checkbox"
                      checked={scopes.includes(scope)}
                      onChange={(e) =>
                        setScopes((old) =>
                          e.target.checked
                            ? [...old, scope]
                            : old.filter((s) => s !== scope),
                        )
                      }
                    />
                    {scope === "shares:read"
                      ? "本人の共有・閲覧履歴を取得"
                      : scope === "shares:write"
                        ? "作成・期限・共有先変更"
                        : "削除"}
                  </label>
                ))}
              </fieldset>
            </details>
            <div className="actions">
              <button
                type="button"
                className="button primary"
                disabled={busy || !scopes.length || !mcpUrl}
                onClick={create}
              >
                {busy
                  ? "発行中…"
                  : token
                    ? "新しいキーを発行"
                    : "キーを発行する"}
              </button>
              {token && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={copyCommand}
                >
                  接続コマンドをコピー
                </button>
              )}
            </div>
            <pre className="code-block mcp-install-command">
              <code>
                {showToken && token
                  ? installCommand(client, os, mcpUrl, token)
                  : command}
              </code>
            </pre>
            {!token ? (
              <p className="hint">
                キーを発行すると、キー入りのコマンドをコピーできます。
              </p>
            ) : (
              <p className="hint">
                表示はキーを隠しています。コピーしたコマンドには、あなたのAPIキーが含まれます。
              </p>
            )}
            {token && (
              <div className="actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? "キーを隠す" : "キーを表示"}
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setToken("");
                    setShowToken(false);
                  }}
                >
                  表示を閉じる
                </button>
              </div>
            )}
            <h2>3. ターミナルで実行して、アプリを再起動</h2>
            <p>
              Node.js 22以降と利用するアプリが必要です。クローンやnpm
              installは不要です。接続ファイルの準備とMCP登録をコマンドが行います。
            </p>
            <p className="mcp-prompt">「このHTMLをsharepagesで共有して」</p>
            <p className="hint">
              このように依頼すると、AIがMCPで共有してURLを返せます。ファイル本文をAIが読み込める環境で使用してください。
            </p>
            <p className="hint">
              コマンドは他人に共有せず、Gitにも保存しないでください。キー更新後は再起動が必要です。既存の別サーバー設定は自動削除しません。
            </p>
            <details className="mcp-advanced">
              <summary>HTTP直接接続・その他のアプリ</summary>
              <p>
                Streamable
                HTTPとカスタムヘッダー対応なら、URLとAPIキーで接続できます。
              </p>
              <pre className="code-block">
                <code>
                  {JSON.stringify(
                    {
                      url: mcpUrl,
                      headers: { Authorization: "Bearer <YOUR_API_KEY>" },
                    },
                    null,
                    2,
                  )}
                </code>
              </pre>
              <p className="hint">
                ChatGPT・Dotsでは、下の任意設定「OAuth接続の手順」を使ってください。
                ローカルのstdio対応アプリは「その他」を選択してください。
              </p>
            </details>
          </section>
          <section className="table-card">
            <div className="section-row">
              <h2>有効なAPIキー</h2>
              <span className="count">{keys.length}件</span>
            </div>
            {keys.length === 0 ? (
              <p className="subtle">有効なキーはありません。</p>
            ) : (
              keys.map((key) => (
                <div className="key-row" key={key.id}>
                  <div>
                    <strong>{key.name}</strong>
                    <small>
                      {key.prefix}… · {datetime(key.expires_at)}まで
                    </small>
                    <small>{key.scopes.join(" / ")}</small>
                  </div>
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={() => setRevoking(key)}
                  >
                    失効する
                  </button>
                </div>
              ))
            )}
          </section>
          {revoking && (
            <section className="edit-panel">
              <h3>「{revoking.name}」を失効しますか？</h3>
              <p>このキーを使っているMCPクライアントは接続できなくなります。</p>
              <div className="actions">
                <button
                  type="button"
                  className="button destructive"
                  disabled={busy}
                  onClick={revoke}
                >
                  失効する
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setRevoking(null)}
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
      <details className="oauth-optional" id="oauth-guide">
        <summary>任意：OAuth接続の手順（ChatGPT・Dots）</summary>
        <p className="hint">
          ChatGPT・Dotsから使う場合だけ設定してください。CodexのAPIキー接続には不要です。
        </p>
        <OAuthSetupGuide mcpUrl={mcpUrl} />
        {session && <OAuthConnections />}
      </details>
    </div>
  );
}
