"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { LoginPanel } from "@/components/shell";
import { api, authClient } from "@/lib/client";
import { oauthRedirectTarget, oauthScopeLabels } from "@/lib/oauth-navigation";

type ConsentDetails = {
  client: { client_id: string; client_name?: string; client_uri?: string };
  scopes: string[];
};

function Consent() {
  const params = useSearchParams();
  const query = params.toString();
  const { data: session, isPending } = authClient.useSession();
  const [details, setDetails] = useState<ConsentDetails | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!session) return;
    let current = true;
    setDetails(null);
    setError("");
    api<ConsentDetails>("/oauth/consent", {
      method: "POST",
      body: JSON.stringify({ oauth_query: query }),
    })
      .then((value) => {
        if (current) setDetails(value);
      })
      .catch((reason: Error) => {
        if (current) setError(reason.message);
      });
    return () => {
      current = false;
    };
  }, [session, query]);
  const decide = async (accept: boolean) => {
    if (!details) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ redirect: boolean; url: string }>(
        "/auth/oauth2/consent",
        {
          method: "POST",
          body: JSON.stringify({ accept, oauth_query: query }),
        },
      );
      window.location.assign(
        oauthRedirectTarget(result, query, window.location.origin),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "連携できませんでした。",
      );
      setBusy(false);
    }
  };
  return (
    <div className="page oauth-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">AUTHORIZE CONNECTION</span>
          <h1>Sharepagesの利用を許可</h1>
          <p>あなたのアカウントで、連携先が下記の操作を行います。</p>
        </div>
      </div>
      {isPending ? (
        <p>読み込み中…</p>
      ) : !session ? (
        <LoginPanel callbackURL={`/oauth/consent?${query}`} />
      ) : details ? (
        <section className="table-card oauth-consent-card">
          <h2>{details.client.client_name || "MCPクライアント"}</h2>
          <p className="hint">
            連携先が指定した名前です。接続を開始したアプリか確認してください。
          </p>
          <small className="oauth-client-id">
            クライアントID: {details.client.client_id}
          </small>
          <p>ログイン中：{session.user.email}</p>
          <h3>許可する操作</h3>
          <ul className="oauth-scopes">
            {details.scopes.map((scope) => (
              <li key={scope}>{oauthScopeLabels[scope] || scope}</li>
            ))}
          </ul>
          <p className="hint">
            共有ページの閲覧権限は引き続き適用されます。連携は「MCP接続」から解除できます。
          </p>
          <div className="actions">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => decide(true)}
            >
              {busy ? "処理中…" : "許可する"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => decide(false)}
            >
              拒否する
            </button>
          </div>
        </section>
      ) : !error ? (
        <p role="status">連携先を確認しています…</p>
      ) : null}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p>読み込み中…</p>}>
      <Consent />
    </Suspense>
  );
}
