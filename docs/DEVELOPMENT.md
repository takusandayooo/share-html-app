# 技術構成と開発ガイド

[サービス紹介](../README.md) · [使い方](USAGE.md) · [セットアップ](SETUP.md) · [技術構成と開発ガイド](DEVELOPMENT.md)

| 役割 | 使用技術 |
| --- | --- |
| 画面 | Next.js App Router・React・OpenNext |
| API・MCP | Hono・@hono/mcp・公式MCP SDK |
| 認証 | Better Auth・Googleログイン・OAuth Provider |
| データ | Cloudflare D1・Drizzle・Web Crypto |
| 開発 | TypeScript・Bun workspaces・Biome |

以下のコマンドやファイルパスは、特記がなければリポジトリのルートを基準にしています。

## 構成

```text
apps/web       Next.js App Router + OpenNext
apps/api       Hono + Better Auth + @hono/mcp + Drizzle
packages/contracts  入力スキーマと共有型
```

Cloudflare WorkersにUIとAPIを個別にデプロイします。メタデータと暗号化したHTML／Markdown本文をD1に保存します。R2は使用しません。画面からの `/api/*` と `/mcp` はNext.js Route HandlerとService Binding経由でAPIの内部入口 `WebApi` へ送ります。公開URLは同じドメインになり、Cookie・Originを保って通信します。DBへの直接アクセスはAPI Workerだけです。

## アクセス制限

認証後の共有・キー管理・MCPリクエストは、ユーザーごとに1分120回までです。Webのセッションと、そのユーザーが発行した全MCPキーで枠を合算します。D1の原子的なカウンターで同時アクセスも数え、他のユーザーとは分離します。`USER_RATE_LIMIT_PER_MINUTE` で変更できます。

WebはAPI転送の前に、Cloudflareが付ける接続元IPで1分600回の防御を適用します。APIの公開入口にも別のIP防御があります。内部入口 `WebApi` はService Bindingからのみ呼び出せ、Webで済ませたIP判定を重複させません。HTTPヘッダーで内部入口を指定・迂回する仕組みはありません。本番で必要なBindingが欠けると503を返します。

IP防御の回数は各Wrangler設定の `ratelimits[].simple.limit`、期間は `period` で設定します。CloudflareのIP防御は拠点ごとの概算制限で、同じ社内ネットワークの利用者はIP枠を共有するため、ユーザー枠より余裕を持たせています。旧来のWorker間通信の共通IPによるD1カウンターは使用しません。過去のカウンターは既存Cronで削除されます。

## 公開と削除

HTML／Markdownの単一UTF-8ファイルを一括5件まで共有します。1ファイル1 MiB、1人の有効共有は100件が初期値です。サイズ・日数・ドメインはサーバー側で検証します。

初期期限は14日、最大は作成時刻から30日です。期限変更を繰り返しても起点は変わりません。期限になるとすぐAPIで閲覧・ダウンロードを止め、Cronが12時間ごと（日本時間9時・21時）に本文と共有レコードを削除します。1回のCronは100件を処理し、失敗分は再試行します。少量利用時の物理削除は通常、失効から12時間以内です。大量の期限切れが同時に発生した場合、物理削除の完了は後続Cronにまたがります。公開アクセス停止はCronを待ちません。

HTMLはsandbox iframeで、インラインスクリプトを許可します。親画面のCookie・DOM・任意のストレージにはアクセスさせず、外部通信や外部CDNをCSPで制限します。埋め込みCSS・画像・スクリプトを含む自己完結ファイルに対応します。Markdownはサニタイズして表示します。ZIP・相対パスの別アセット・複数ファイルをまとめたサイトの公開には対応していません。

共有期限とAPIキー期限は別です。キーは初期30日、最大90日で発行できます。すでに取得・ダウンロードされた内容は回収できません。自動削除は稼働データを対象とし、インフラのバックアップ保持はCloudflareの設定・仕様に従います。

## MCP

**`@hono/mcp`** のStreamable HTTP Transportと公式MCP SDK v1を使用しています。**個人APIキーとOAuth 2.1の両方**に対応します。既存の個人APIキー・インストーラーによる接続はそのまま使えます。

1. 会社のGoogleアカウントでWebへログインします。
2. MCP接続画面で、名前・権限・有効期間を指定してキーを発行します。
3. キーは一度だけ表示されます。サーバーにはSHA-256ハッシュのみ保存します。
4. Streamable HTTPのURLとBearerヘッダーをクライアントへ設定します。

```json
{
  "mcpServers": {
    "sharepages": {
      "type": "http",
      "url": "https://<公開ドメイン>/mcp",
      "headers": { "Authorization": "Bearer <YOUR_API_KEY>" }
    }
  }
}
```

設定書式はクライアントによって異なります。URL＋カスタムAuthorizationヘッダーを登録できるStreamable HTTPクライアントが必要です。OAuthのみ受け付けるChatGPT・Dotsでは、下記のOAuth接続を使用します。公式SDK v1クライアントで2025-11-25系の初期化・ツール一覧・全ツール呼び出しを検証しています。MCP v2の2026-07-28プロファイルや旧SSEには対応していません。ローカルのstdioクライアントには専用bridgeがStreamable HTTPへ中継します。

`POST /mcp` で呼び出します。GET／DELETEの常設ストリームやセッションは使わず、リクエストごとにMCPサーバーを作ります。ログインCookieだけではMCPに接続できません。キー失効・期限切れ・メールドメインの設定変更は、次のリクエストで反映します。

| ツール | 権限 |
| --- | --- |
| `get_profile` | `shares:read` |
| `create_share` | `shares:write` |
| `list_shares`、`get_share`、`get_share_views` | `shares:read` |
| `update_share_expiry`、`update_share_sharing` | `shares:write` |
| `delete_share` | `shares:delete` |

MCPは本人の共有だけを操作します。`get_share` はメタデータだけを返します。ローカルパスをサーバーへ渡す代わりに、クライアントがファイルを読み、`create_share` の `filename` と `content` に渡してください。`idempotency_key` はUUIDで必須です。同じ内容の再送には同じキーを使います。

```json
{
  "filename": "report.html",
  "content": "<!doctype html><h1>レポート</h1>",
  "expires_in_days": 14,
  "idempotency_key": "<UUID>"
}
```

## 検証

```sh
bun run check
bun test
bun run build:cloudflare
bun run --filter @share/api build
```

Bunテストは実SQLiteとmigrationを使い、Better Authの署名付きセッション、所有者制限、期限の境界、冪等性、容量、削除再試行、APIキーハッシュ・失効・スコープ、公式MCP SDKからの全ツール呼び出しを確認します。Cloudflare D1の実装固有の挙動はWorkersプレビューでも確認します。画面のWorkersプレビューとAPIを起動した状態で `cd apps/api && bun scripts/smoke-local.ts http://localhost:3030` を実行すると、ローカルのD1へ一時的なテストデータを作り、公式SDKからネットワーク経由で検証した後に削除します。本番URLは拒否します。

本番ビルドの互換性のため、Next.jsは16.3.6に固定しています。16.4.0ではOpenNext 1.20.9のWorkersプレビューに `preview-props.json` の読み込みエラーがあったためです。その他も納品時のバージョンをpackage.jsonとBun lockfileへ固定します。

認証schemaを更新するときは `cd apps/api && bun scripts/generate-auth-schema.ts` を利用します。既存の適用済みmigrationを上書きしてデプロイせず、新しい差分migrationを追加してください。

コミット名はprefix付きの日本語にします。例：`feat: 期限付き共有とMCPキー認証を追加`。

Google OAuthの発行前に公開URLを確定する場合は `bun run prepare:deploy .env.production --allow-unconfigured-auth` を使えます。その状態ではGoogleログインを無効にして公開します。発行後に `wrangler secret put` の対話入力でGoogle資格情報を登録してください。

D1には1つの値・1行が2,000,000バイトという制限があるため、アプリの上限は余裕を持って1 MiBに固定しています。HTMLに画像を埋め込む場合も、この上限に含まれます。[Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

## 共有先の設定

投稿時とマイページの「共有先変更」で次の範囲を選択できます。未指定と既存ファイルは大社内のURL共有です。

既存データとAPIクライアントとの互換性のため、社内共有の内部識別子は `university` を継続して使用します。

- `university`：URLを知っている対象会社のGoogleアカウント全員。
- `selected`：投稿者と `recipients` に指定した会社メール（最大50件）。通知メールは送信しません。相手の「共有されたページ」に表示します。
- `public`：URLを知っている全員。ログインなしで本文とダウンロードを利用できます。

公開範囲を狭めると次のアクセスから制限します。取得済み・保存済みの内容は回収できません。本文・メタデータ・ダウンロードで同じ判定を適用し、期限・削除は全範囲で同じです。共有先のメール一覧を取得できるのは投稿者のみです。

MCP `create_share` に `audience`／`recipients` を指定でき、`update_share_sharing`（`shares:write`）で変更できます。MCPは全員公開ページの操作でもAPIキーまたはOAuthトークンを必須とします。

追加migration：`0004_sharing.sql`。WebのAPI転送はNext.jsのRoute Handlerを使い、OAuthの302とSet-Cookieをブラウザへそのまま返します。

## 表示と閲覧履歴

共有ページは本文をブラウザの表示領域いっぱいに表示し、上部の小さなバーにタイトル・詳細・全画面・ダウンロードをまとめています。Fullscreen API非対応の端末では画面内表示に切り替えます。HTMLのsandboxとCSPは維持します。

マイページの「閲覧履歴」から、投稿者だけが閲覧者の名前・会社メール・初回／最終アクセス・閲覧／ダウンロード回数を確認できます。匿名は人物を特定せず件数と時刻だけを集計します。本人のアクセスとメタデータ取得は計上しません。記録は成功した本文取得とダウンロードを基準にするため、実際に読了したことを保証する指標ではありません。履歴記録の障害で本文閲覧を止めません。

履歴はこの機能の追加以降のみ記録し、共有削除時のFK cascadeで削除します。IPや端末情報を閲覧履歴用に保存しません。MCPの `get_share_views` は `shares:read` のキーと所有者認可が必要です。追加migrationは `0005_share_views.sql`。

## MCPの一発設定

`/keys` でアプリとOSを選び、キーを発行して「接続コマンドをコピー」。macOS/LinuxのシェルまたはWindows PowerShellで実行し、アプリを再起動します。対応するローカル設定はCodex、Claude Code、Claude Desktop（macOS/Windows）、Antigravity、Cursor、VS Code。その他のstdioクライアントには登録用JSONを出力します。Node.js 22以降が必要です。CodexとVS Codeでは各CLIが必要です。ChatGPT・DotsのOAuth接続には下記の手順を使い、このローカルインストーラーは実行しません。

コマンドは公開インストーラーをダウンロードし、キーを標準入力から渡します。キーはOSのシェル履歴にも残りうるためコマンドを共有しないでください。専用の `~/.sharepages/<client>.json` へ保存し、Unixではディレクトリ700／ファイル600とします。MCP設定にはキーを含めずNodeの絶対パス、公式SDKを同梱したbridgeの絶対パス、資格情報ファイルのパスだけを登録します。

JSON設定は他のサーバーを保持して追加し、既存ファイルのバックアップを作ります。別のsharepages設定がある場合は自動削除せず停止します。新しいキーを発行しても古いキーは自動失効しません。不要なキーはWebの有効キー一覧から失効してください。接続ファイルはコマンドの再実行時に更新し、整合性をSHA-256で検証します。自動でローカルソフトウェアを更新する機能はありません。

公式設定資料：[Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)、[Claude Code](https://code.claude.com/docs/en/mcp)、[Claude Desktop](https://modelcontextprotocol.io/docs/develop/connect-local-servers)、[Antigravity](https://antigravity.google/docs/mcp)、[Cursor](https://cursor.com/docs/mcp)、[VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers)。設定形式とコマンドを確認し、公式MCP SDKクライアントでNode stdio接続を検証しました。各デスクトップアプリとWindows端末での実機検証は未実施です。

共有ビューの上部バーは撤去し、本文のみを全画面表示します。右上の小さな操作から詳細・ダウンロード・全画面・折りたたみを利用できます。投稿者は目のアイコンで閲覧した会社の利用者を確認できます。

TOPは `/`、ファイル共有は `/upload`。TOPでサービス概要・共有範囲・期限・MCP設定・ファイル条件を説明し、共有画面へ案内します。

許可メールドメイン：`company.example`。社員の会社のGoogleアカウントで投稿・管理でき、メール指定の共有先にも両方を指定できます。

## 本文の暗号化

新規本文はAES-256-GCMで暗号化してからD1の `share_contents` に保存します。毎回ランダムな96-bit IVを生成し、共有IDと形式バージョンを認証対象に含めるため、改ざんや別共有への暗号文の入れ替えは復号に失敗します。APIは閲覧権限・期限を確認し、復号後にも再確認して元の本文を返します。鍵未設定・誤った鍵・破損時はエラーになり、平文保存や暗号文の表示には戻りません。DBには暗号文・IV・形式だけを置き、鍵は保存しません。最大1 MiBの本文はBase64化後もD1の2 MB行上限内です。

鍵 `CONTENT_ENCRYPTION_KEY` は32バイトを64桁のhexで指定し、認証用の `BETTER_AUTH_SECRET` とは独立させます。ローカルでは `bun run setup:env` が `.env` に一度だけ生成し、API専用 `.dev.vars` に書きます。本番用はローカルと別の鍵を一度だけ用意し、`wrangler secret put CONTENT_ENCRYPTION_KEY` の対話入力でAPI Workerへ直接登録します。`prepare:deploy` は鍵を生成・保存しません。本番SecretsはWeb側には渡しません。鍵をログや共有資料に貼らず、パスワードマネージャーなどへ控えてください。既存の暗号文がある環境の鍵を上書き・再生成すると読めなくなります。この版は鍵ローテーションに未対応です。

本番適用はAPIディレクトリで次の順です（稼働中の旧版は適用中も平文を書くため、完全移行までは完了とみなさないでください）。

```sh
bunx wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc
bunx wrangler secret put CONTENT_ENCRYPTION_KEY --config wrangler.production.jsonc
bunx wrangler deploy --config wrangler.production.jsonc
```

追加migration `0006_content_encryption.sql` は既存本文に `encoding='plaintext'` を付けます。新APIは閲覧時にその行を暗号化し、既存Cronも12時間ごとに最大1件ずつ変換（無料枠のCPU負荷を抑えるため）します。移行中は未変換の行が平文のまま残ります。以下の確認が0になるまで移行は未完了です。

```sh
bunx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT COUNT(*) AS plaintext_remaining FROM share_contents WHERE encoding='plaintext'"
```

ローカルの既存本文はWranglerを停止して `bun run setup:env` と `bun run db:migrate` を実行し、`cd apps/api && bun scripts/encrypt-local-content.ts --local` で一括変換できます。元の本文を復号して一致することを確かめてから更新し、再実行可能です。

これはDBの直接閲覧から本文を隠す対策です。タイトル・ファイル名・所有者・共有先などのメタデータは平文です。Workerのコード変更権限を持つ管理者は鍵を利用して復号できます。また、D1 Time Travel・過去のバックアップに残った平文までは消去しません。ロールバックで旧APIに戻すと暗号文をそのまま表示するため、旧APIへ戻さないでください。

復号前のBase64変換はWorkersのネイティブ `node:buffer` を使います。1文字ずつJavaScriptで変換しません。2026-10-10のローカルworkerd測定では、1 MiBで鍵import・復号・応答まで平均0.62 ms、p95 0.68 ms（各サイズ100回、事前10回warm-up）でした。これはローカルの経過時間で、本番のCPU時間や認証・D1を含むAPI全体の保証ではありません。Workers FreeはHTTP/CronともCPU 10 msのため、本番反映後にWorkers LogsのCPU時間を確認してください。

## 共有HTMLのlocalStorage

HTMLは `sandbox="allow-scripts"` を維持し、Cookieや親DOMにアクセスできません。sandboxによるopaque originではネイティブlocalStorageが使えないため、HTMLスクリプトの実行前に互換APIを注入します。getItem/setItem/removeItem/clear/key/lengthとプロパティ形式の読み書きに対応し、読み込み時の保存内容を同期的に使えます。親画面がpostMessage経由でブラウザのlocalStorageへ保存します。送信元iframe、origin、表示ごとのtokenと操作形式を確認し、親で固定した保存キーだけを操作します。allow-same-originは追加しません。

保存領域は共有IDと閲覧ユーザーIDで分離し、匿名は匿名用の領域になります。別の共有や同じブラウザの別ログインユーザーのデータは見えません。同じ匿名ブラウザを使う人同士は同じ匿名領域を使います。DBには保存せず、端末・ブラウザを替えると引き継がれません。1領域はJSONで262144 UTF-16コード単位まで（最大約512 KiB）、ブラウザ全体の容量制限も適用されます。clearはその共有の保存領域だけを削除します。別タブでの変更はstorageイベントで反映します。

これは通常のlocalStorage呼び出し用の互換APIで、Storage.prototypeの直接呼び出し・IndexedDB・sessionStorageは提供しません。iframe内の更新は即時ですが、ディスクへの保存は親へのメッセージ処理後です。setItem直後の即時リロード／強制終了では最後の変更が未保存になる場合があります。プライベートブラウズやブラウザの保存拒否・容量超過時は保存できない旨を表示します。保存は会社アカウントのクラウド同期ではなく、その閲覧者のブラウザ内の保存です。

## 共有HTMLのリンク

ページ内の `#id`・同じ共有URLのfragment・名前付きアンカーはsrcDoc内で移動します。HTTP/HTTPSリンクはクリック時に別タブで開き、noopener/noreferrerを付けます。targetの指定にかかわらず親画面を移動させません。mailto/telもクリック時にブラウザへ渡します。動的に追加したリンク、リンク内の子要素、キーボード・中クリックにも対応します。ページ自身のハンドラーがpreventDefaultしたリンクはその処理を優先します。data/file/blob等への外部移動はブロックし、既存javascriptリンクはsandbox内のスクリプトとして扱います。

iframeにallow-popupsとallow-popups-to-escape-sandboxを追加し、リンク先を通常のタブとして利用できるようにします。allow-same-originと親画面へのnavigationは許可せず、Cookie・親DOMの隔離と外部通信のCSP制限は維持します。ブラウザ自体のポップアップ禁止設定は引き続き適用されます。window.openも通常のブラウザのユーザー操作・ポップアップ制限に従います。アップロードされていない相対パスの別HTML・画像ファイルは提供しません。

本番の既存本文をすぐ一括変換する場合、上記migration・Secret登録・新APIデプロイを済ませてから、プロジェクトルートで `bun run content:encrypt:remote` を実行します。`.env.production` の `CLOUDFLARE_API_TOKEN` があれば使用し、なければ既存Wrangler認証を使用します。対象は明示した本番アカウント・DBです。既存の暗号文と鍵の一致を確認し、平文を10件ずつ読み、暗号化・復号一致の確認後に条件付きで更新します。DBへ保存された暗号文も再取得して一致を検証し、最後に平文の残件数を表示します。本文や鍵はログへ出しません。再実行可能です。直接DBを操作するトークンには対象アカウントのD1 Editが必要です。Workersの編集権限だけではD1を直接操作できません。APIトークンは環境設定で管理し、Gitに入れないでください。

## ChatGPT・DotsのOAuth接続

ChatGPTのPlugins画面で「＋」→「Add custom MCP server」を選び、サーバーURLに `https://sharepages.example/mcp`、認証にOAuthを指定します。認証設定は自動検出します。クライアント登録は動的クライアント登録（DCR）、トークンエンドポイント認証方法は `none`。既存の個人APIキーをクライアントシークレット欄へ入れる必要はありません。

要求する権限は `shares:read`（本人の共有情報・閲覧履歴・プロフィール）、`shares:write`（作成・期限・共有先変更）、`shares:delete`（削除）。再ログインせず接続を継続するには `offline_access` も要求します。接続するとSharepagesの会社のGoogleログインへ進み、Sharepagesの同意画面でアプリ名・本人アカウント・権限を確認して許可します。連携はMCP接続画面のOAuth連携一覧から解除でき、アクセストークンとリフレッシュトークンを失効させます。ブラウザのログインCookieだけでMCPを使う経路はありません。

認可サーバーは公式 `@better-auth/oauth-provider` を使用し、Authorization Code + PKCE S256、5分の単回使用認可コード、1時間のアクセストークン、30日のリフレッシュトークンを扱います。opaqueトークンはハッシュで保存し、MCPが毎回有効期限・発行者・resource・scope・会社ユーザーを確認します。リフレッシュはローテーションし、旧トークンの再使用を拒否します。既存のAPIキーは引き続き `shp_`、OAuth用は別形式です。

公開メタデータ：

- resource：`https://sharepages.example/mcp`
- issuer：`https://sharepages.example/api/auth`
- protected resource metadata：`/.well-known/oauth-protected-resource/mcp`（root版も提供）
- authorization server metadata：`/.well-known/oauth-authorization-server/api/auth`（root版も提供）
- register：`/api/auth/oauth2/register`
- authorize：`/api/auth/oauth2/authorize`
- token：`/api/auth/oauth2/token`
- revoke：`/api/auth/oauth2/revoke`

認証のないMCPリクエストは401と `WWW-Authenticate` のresource_metadataで自動検出を案内します。共有操作は既存の所有者チェックを通し、各ツールは要求scopeを公開します。`get_profile` は認証された本人のID・名前・メールだけを返すread-onlyツールです。

本番反映前に `0007_oauth.sql` を対象D1へ適用し、APIとWebをデプロイしてください。OAuth専用の新しいGoogleクライアントや秘密鍵は不要です。既存のGoogle OAuth認証情報とBetter Auth secretを維持します。ローカルGoogleのcallbackを使う場合は対象localhostポートをGoogle側へ登録してください。

[OpenAI認証仕様](https://developers.openai.com/plugins/build/auth)、[Better Auth OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider)

## GitHub公開前の確認

`bun run check:public` はGit対象のファイルに個人メール・ローカルパス・認証情報の候補や非公開設定が混ざっていないか検査します。値は表示しません。画像とGit履歴は別途確認が必要です。既存履歴に情報が含まれる場合、ファイルを直すだけでは履歴から消えません。公開には履歴を含まない確認済みソースから新しいリポジトリを作成してください。

`wrangler.jsonc` は秘密情報を含まないサンプルです。本番固有の値はGit対象外の `.env.production` から設定ファイルへ生成します。認証用秘密情報はCloudflare Secretsへ対話登録します。生成された本番設定・環境ファイル・DB・ログを公開しないでください。問い合わせ先は任意の `SUPPORT_EMAIL` で設定します。この値はサイトに表示される公開情報です。

## 確認状況

認可・署名検証・PKCE・トークン更新・連携解除・APIキー互換性を自動テストとローカルWorkersで確認しています。ChatGPT側のOAuth設定検出とプラグイン登録は確認済みですが、実際のアカウントでの接続完了とツール呼び出しは未確認です。
