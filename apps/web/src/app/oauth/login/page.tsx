"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { LoginPanel } from "@/components/shell";
import { api, authClient } from "@/lib/client";
import { oauthRedirectTarget } from "@/lib/oauth-navigation";

function OAuthLogin() {
  const params = useSearchParams();
  const query = params.toString();
  const { data: session, isPending } = authClient.useSession();
  const resumed = useRef(false);
  const [error, setError] = useState("");
  const valid = params.has("sig") && params.has("client_id");
  const requiresLogin =
    params.get("prompt")?.split(" ").includes("login") || params.has("max_age");
  useEffect(() => {
    if (!session || !valid || requiresLogin || resumed.current) return;
    resumed.current = true;
    api<{ redirect: boolean; url: string }>("/auth/oauth2/continue", {
      method: "POST",
      body: JSON.stringify({ postLogin: true, oauth_query: query }),
    })
      .then((result) => {
        window.location.assign(
          oauthRedirectTarget(result, query, window.location.origin),
        );
      })
      .catch((reason: Error) => setError(reason.message));
  }, [session, query, valid, requiresLogin]);
  return (
    <div className="page oauth-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONNECT SHAREPAGES</span>
          <h1>Sharepagesにログイン</h1>
          <p>ログイン後に、連携先と許可する操作を確認できます。</p>
        </div>
      </div>
      {!valid ? (
        <p className="error" role="alert">
          接続要求が見つかりません。接続元からやり直してください。
        </p>
      ) : isPending || (session && !requiresLogin && !error) ? (
        <p role="status">接続を続けています…</p>
      ) : error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : (
        <LoginPanel callbackURL={`/oauth/login?${query}`} />
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p>読み込み中…</p>}>
      <OAuthLogin />
    </Suspense>
  );
}
