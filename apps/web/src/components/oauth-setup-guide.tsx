"use client";

export function OAuthSetupGuide({ mcpUrl }: { mcpUrl: string }) {
  return (
    <section className="table-card mcp-setup-card oauth-guide">
      <h2>OAuth接続の手順（ChatGPT・Dots）</h2>
      <p>
        <a
          href="https://chatgpt.com/plugins?directoryTab=personal"
          target="_blank"
          rel="noreferrer"
        >
          ChatGPTの「個人用プラグイン」
        </a>
        で「＋」→「カスタムMCPサーバーを追加」を開き、
        次の内容を入力してください。APIキーの発行やコピーは不要です。
      </p>
      <ol className="oauth-guide-steps">
        <li>
          <h3>サーバーの名前・URL・認証を入力</h3>
          <dl className="oauth-guide-fields">
            <div>
              <dt>名前</dt>
              <dd>Sharepages</dd>
            </div>
            <div>
              <dt>サーバーURL</dt>
              <dd>
                <code>{mcpUrl || "接続先を読み込み中…"}</code>
              </dd>
            </div>
            <div>
              <dt>認証</dt>
              <dd>OAuth</dd>
            </div>
          </dl>
          <p>
            URLの末尾は <code>/mcp</code>{" "}
            です。入力後、OAuthの詳細設定を開きます。
          </p>
          <figure>
            <a
              href="/oauth-guide/01-add-server.png"
              target="_blank"
              rel="noreferrer"
              aria-label="カスタムMCP追加画面を原寸で開く"
            >
              {/* biome-ignore lint/performance/noImgElement: Actual setup screenshot retains its natural size and can be opened directly. */}
              <img
                src="/oauth-guide/01-add-server.png"
                width={1140}
                height={1380}
                alt="ChatGPTのカスタムMCP追加画面。名前にSharepages、サーバーURLに末尾が/mcpのURL、認証にOAuthを指定する。"
                loading="lazy"
              />
            </a>
            <figcaption>
              ①
              カスタムMCP追加画面。画像内のURLは黒塗りです。接続時は上のサーバーURLを入力してください。
            </figcaption>
          </figure>
        </li>
        <li>
          <h3>OAuthの詳細設定を確認</h3>
          <dl className="oauth-guide-fields">
            <div>
              <dt>登録方法</dt>
              <dd>動的クライアント登録（DCR）</dd>
            </div>
            <div>
              <dt>基本スコープ（ベーススコープ）</dt>
              <dd>
                <code>offline_access</code> を1行で入力
              </dd>
            </div>
            <div>
              <dt>その他の項目</dt>
              <dd>自動検出された値・初期値のまま</dd>
            </div>
          </dl>
          <p>
            クライアントIDやクライアントシークレットの手入力は不要です。
            設定を保存し、Sharepagesのプラグインを作成・インストールします。
          </p>
          <figure>
            <a
              href="/oauth-guide/02-oauth-settings.png"
              target="_blank"
              rel="noreferrer"
              aria-label="OAuthのクライアント登録設定を原寸で開く"
            >
              {/* biome-ignore lint/performance/noImgElement: Actual setup screenshot retains its natural size and can be opened directly. */}
              <img
                src="/oauth-guide/02-oauth-settings.png"
                width={416}
                height={335}
                alt="ChatGPTのOAuthクライアント登録設定。登録方法に動的クライアント登録DCRを選択している。"
                loading="lazy"
              />
            </a>
            <figcaption>
              ② クライアント登録。「動的クライアント登録（DCR）」を選びます。
            </figcaption>
          </figure>
          <figure>
            <a
              href="/oauth-guide/03-base-scope.png"
              target="_blank"
              rel="noreferrer"
              aria-label="OAuthのスコープ設定を原寸で開く"
            >
              {/* biome-ignore lint/performance/noImgElement: Actual setup screenshot retains its natural size and can be opened directly. */}
              <img
                src="/oauth-guide/03-base-scope.png"
                width={416}
                height={508}
                alt="ChatGPTのOAuthスコープ設定。デフォルトのスコープ4項目はそのまま、基本スコープ欄にoffline_accessを入力している。"
                loading="lazy"
              />
            </a>
            <figcaption>
              ③ スコープ設定。「基本スコープ」欄に offline_access
              を入力します。デフォルトのスコープ4項目はそのままです。
            </figcaption>
          </figure>
          <p className="hint">
            設定が検出されない場合は、サーバーURLを確認して再試行してください。
            APIキーをクライアントシークレット欄に入力する必要はありません。
          </p>
        </li>
        <li>
          <h3>Googleでログインして利用を許可</h3>
          <p>
            プラグインの接続を開始するとSharepagesが開きます。
            対象の大学Googleアカウントでログインし、連携先と要求された操作を確認して
            「許可する」を押してください。ログイン済みの場合は許可画面から始まります。
          </p>
        </li>
        <li>
          <h3>プロフィール取得で接続を確認</h3>
          <p>Sharepagesを選んだ会話で、次のように依頼してください。</p>
          <p className="mcp-prompt">
            「Sharepagesのget_profileだけを呼んで、接続を確認して」
          </p>
          <p className="hint">
            プロフィールが取得できれば接続確認は完了です。
            連携を解除するときは、このページの「OAuthで連携中のアプリ」から操作できます。
          </p>
        </li>
      </ol>
    </section>
  );
}
