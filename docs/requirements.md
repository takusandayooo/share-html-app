# HTML Markdown共有アプリ 要件定義案

作成日：2026年10月8日

HTMLやMarkdownをアップロードし、大社内・指定した会社メール・全員向けの公開URLから共有先を選び、期限付きURLで共有する。ブラウザとMCPの両方から操作でき、公開期限の初期値は14日、上限は30日とする。

実装先は `<project-directory>`。実装とCloudflareへのデプロイを行う。

## 確定要件と初期案

| 項目 | 要件 | 状態 |
| --- | --- | --- |
| 用途 | HTML／Markdownの期限付き共有 | 依頼と参考記事を基にした要件 |
| 実装先 | 指定のDesktopフォルダ | 確定 |
| 技術 | Next.js、Hono、Drizzle、Bun、Biome、Cloudflare | 確定 |
| メールドメイン | 初期値 `company.example`、環境変数で変更可能 | 確定 |
| 認証対象 | 投稿・管理は会社限定。大社内・指定先の閲覧は認証必須、全員公開はログイン不要 | 追加依頼を反映 |
| 初期期限 | 14日、環境変数で変更可能 | 確定 |
| 期限の変更 | 投稿者本人が変更できる | 確定 |
| 最大期間 | 作成時刻から30日まで。「1ヶ月」は固定30日として扱う | 解釈の初期案 |
| 認証方式 | Better Authで会社のGoogleアカウントにログインする | ユーザー回答を反映 |
| データ保存 | メタデータとHTML／Markdown本文はD1。R2は使用しない | 技術構成の初期案 |
| アップロード上限 | 1ファイル1 MiB、一括5ファイル、1人の有効共有100件 | 初期案、環境変数で調整 |

## 利用者と権限

対象ドメインのメール所有を確認した人が利用できる。メールの文字列を入力するだけでは認証済みにしない。ドメインは完全一致で検証し、`company.example.example.com` や未許可のサブドメインは拒否する。

Better AuthのGoogle providerで認証し、検証済みのGoogleプロフィールにあるメールアドレスとメール確認状態をサーバー側で確認する。Googleの`hd`等によるログイン画面の絞り込みだけをアクセス制限には使わない。新規登録時と再ログイン時に許可ドメインを検証し、メール・パスワード登録や別providerからの迂回を有効にしない。[Better Auth Google認証](https://better-auth.com/docs/authentication/google)、[OAuthのユーザー検証](https://better-auth.com/docs/concepts/oauth)

会社のGoogleアカウントがGoogle OAuthで利用できること、会社側でアプリ利用を制限していないことを実装時に確認する。Google Cloud側ではOAuth client ID／secret、同意画面、開発・本番それぞれのcallback URLを設定する。

投稿者は自分のファイルの作成・一覧・詳細確認・期限変更・削除を行う。対象ドメインで認証した閲覧者は、URLを知る有効な共有を閲覧・ダウンロードできる。他人の共有一覧や管理操作は許可しない。共有範囲は大社内のURL共有、最大50件の会社メール指定、ログイン不要の全員公開から選べる。会社メールの指定先には受け取った共有一覧を提供する。投稿者本人だけが範囲と指定先を変更できる。通知メールは送信しない。

認証後は元の閲覧URLに戻す。ドメイン制限は画面だけでなく、API・ダウンロード・MCPでもサーバー側で適用する。セッションにも期限を設け、許可ドメインを設定変更した場合は各リクエストで現在の設定を再検証する。

## ブラウザでの共有

1. 会社メールでログインする。
2. `.html`、`.htm`、`.md`、`.markdown` を選択またはドラッグ＆ドロップする。
3. タイトル、公開期間、共有先を設定する。未指定なら14日とする。
4. ファイル保存完了後に共有URL、失効日時、残り時間を表示する。
5. URLをコピーして共有する。複数ファイルの場合は結果を個別表示し、成功したURLをまとめてコピーできる。

UTF-8の単一ファイルを対象とする。HTML内に埋め込んだCSS・JavaScript・画像は扱うが、ローカルの相対パスで参照する別ファイル、ZIP、フォルダ一式は初期版の対象外。タイトル未指定時は元ファイル名を使用する。実行用の共有URLには推測しにくいランダムIDを使い、ファイル名・メールアドレスを含めない。

拡張子、実際のバイト数、文字コードをサーバーで検証する。複数ファイルは個別に成功・失敗を返す。本文の保存と公開状態の切り替えはD1のバッチ処理でまとめ、保存途中の共有を公開しない。再送で二重登録しないよう作成APIとMCPに冪等キーを設ける。

## 公開期間と自動削除

- 初期期限は `created_at + 14日`。
- 作成時に1〜30日を選択できる。既存共有の変更は未来の失効日時を指定し、`created_at + 最大期間` を超えない。
- 14日から30日への延長も、作成時点から合計30日まで。変更を繰り返して永久に残すことはできない。
- 期限変更は本人の有効な共有に限る。期限切れ・削除済み共有は復活できない。
- `now >= expires_at` になった時点で、閲覧・ダウンロード・MCP経由の本文取得を停止する。
- Cronは12時間間隔（日本時間9時・21時）で期限切れのD1に保存した本文と共有レコードを削除する。1回100件まで削除し、残りと失敗分は次回に処理する。少量利用時の物理削除目標は失効から12時間以内とする。期限切れ時の閲覧・ダウンロード停止はAPI側で即時に行い、Cronの実行を待たない。
- 手動削除は即時にアクセスを止める。DB削除に失敗しても再公開せず、Cronで再試行する。

失効判定はリクエストごとに行う。Cronの実行だけに依存しない。共有本文やダウンロードに長期キャッシュ・ISR・公開ストレージURLを使わず、`Cache-Control: private, no-store` を返す。削除と期限変更の競合はDBで状態と期限を条件付き更新して解決する。

時刻はUTCで保存し、画面は日本時間で表示する。たとえば10月8日18時に作成した共有の初期期限は10月22日18時、最大期限は11月7日18時となる。

アクセス停止と物理削除は別の処理である。すでにダウンロードされたファイルや開いている画面の内容は回収できない。削除要件はアプリの稼働データを対象とし、Cloudflareのバックアップ等の保持仕様は運用設計で別途確認する。ログには本文やトークンを記録しない。

## 閲覧画面とHTMLの扱い

共有ページにはタイトル、元ファイル名、失効日時、残り時間、ダウンロードボタンを表示する。期限切れは専用の案内画面にする。スマートフォンでも閲覧・ダウンロード・アップロードできる日本語UIとする。

HTMLは `sandbox="allow-scripts"` のiframeで表示し、`allow-same-origin` を付けない。インラインJavaScriptによる図表や操作を許可しつつ、親画面のDOM・Cookie・ストレージへのアクセス、フォーム送信、ポップアップ、親画面の遷移を制限する。CSPで外部通信・外部スクリプト・外部画像を初期状態では許可しない。外部CDN依存のHTMLはそのままでは動作しないため、自己完結したHTMLを対象とする。

Markdownは見出し、表、リスト、リンク、コードブロックを表示し、変換後のHTMLをサニタイズする。Markdown内の任意スクリプトは実行しない。元ファイルは安全なファイル名を付けてattachmentとしてダウンロードさせる。

対象ドメイン外・未認証利用者やリンクプレビューbotには、タイトル・本文・メールアドレスを渡さない。OGPはサービス共通の情報に限る。共有内容を検索エンジンに登録しない。

## マイページ

本人の有効な共有をページ分割して表示する。タイトル、作成日時、期限、残り時間、共有URLのコピー、期限変更、削除を提供する。物理削除が完了した共有は一覧から消える。初期版に閲覧数・閲覧者履歴・全文検索は含めない。

## MCP

初期版からHonoの `/mcp` にStreamable HTTPを提供する。ユーザー指定のHono公式 `@hono/mcp` と、対応する公式MCP SDK v1を利用する。MCPの接続には個人APIキーを必須とし、GoogleログインのCookieだけでは利用できない。[Hono MCP](https://github.com/honojs/middleware/tree/main/packages/mcp)

会社のGoogleアカウントでログインした本人が画面からキーを発行する。キーは256bitの乱数を使い、作成時に一度だけ表示する。DBにはSHA-256ハッシュだけ保存する。名前・有効期間・操作権限を指定でき、即時に失効できる。キー期限の初期値は30日、最大90日、有効なキーは1人10件までとする。これは共有ページの公開期限とは別の設定である。

接続時は `Authorization: Bearer <API_KEY>` を使う。APIキーの期限、失効状態、所有者のメール確認状態と許可ドメインをリクエストごとに検証する。MCPは本人の共有だけを管理する。

| ツール | 入力の要点 | 権限 |
| --- | --- | --- |
| `create_share` | ファイル名、UTF-8本文、任意のタイトル・日数、必須のUUID冪等キー | `shares:write` |
| `list_shares` | カーソルとページサイズ | `shares:read` |
| `get_share` | 共有ID。本人のメタデータのみ返す | `shares:read` |
| `update_share_expiry` | 共有IDとISO 8601の失効日時 | `shares:write` |
| `delete_share` | 共有ID | `shares:delete` |

HTTP APIとMCPは共通の共有サービスを呼び、期限・容量・所有者制限を共用する。ローカルファイルはクライアント側で読み込んだ本文を送る。Cloudflare側で利用者のローカルパスを読み込まない。

リクエストごとにMCPサーバーとtransportを作り、利用者情報を共有するグローバルなセッションを持たない。Origin検証、入力サイズ制限、永続的なレート制限を適用する。削除ツールには破壊的操作の注釈を付ける。

公式SDK v1クライアントで、初期化・ツール一覧・作成・一覧・期限変更・削除・キー失効まで検証する。キーなし・Cookieのみ・期限切れ・権限不足・他人のIDで操作できないことを確認する。MCP 2025-11-25系のStreamable HTTPを対象とする。MCP v2の2026-07-28、旧SSE、stdio、OAuthのみの接続は初期版の対象外とする。

クライアントはURLとカスタムAuthorizationヘッダーを設定できるものが必要。OAuthしか受け付けないホストは追加対応が必要となる。

## 技術構成

| 要素 | 役割 |
| --- | --- |
| Next.js App Router／TypeScript | ログイン、投稿、マイページ、閲覧、MCP接続管理のUI |
| Cloudflare Workers | Next.jsのホスティングとHono APIの実行 |
| Hono | 認証、共有管理API、ダウンロード、MCP、Cron削除 |
| Better Auth | Googleログインとブラウザのセッション管理 |
| Cloudflare D1／Drizzle ORM | ユーザー、セッション、共有期限、個人APIキー、HTML／Markdown本文 |
| Bun | 依存管理、ローカル開発コマンド、lockfile |
| Biome | lintとformat |
| Wrangler | ローカルWorkers環境、D1 migration、デプロイ |

Next.js本体を使う要件に合わせ、OpenNextアダプターによるWorkers配信を第一案とする。Cloudflare公式では現在vinextを推奨しているが、vinextはNext.js APIの再実装でbetaと説明されている。採用するNext.js／OpenNextの組み合わせは、実装前にWorkersでビルド・プレビュー確認する。[Cloudflare Next.js公式](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)

Bun workspacesで `apps/web`、`apps/api`、`packages/contracts` に分ける。UI用WorkerとHono用Workerを個別にデプロイし、同一サイトの `/api/*` と `/mcp` をNext.js rewriteでHonoへ送る。共有本文取得は認証済みAPI経由とする。R2のbindingは定義しない。CronはHono側Workerで処理する。[Hono Workers対応](https://hono.dev/docs/getting-started/cloudflare-workers)、[Drizzle D1対応](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1)、[Cloudflare Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

Bunは開発・依存管理に使用する。本番の実行環境はCloudflare Workersとする。UI、HTTP API、MCPが共通の共有サービスを呼び、期限計算や権限検証を共用する。

Better AuthはHono側の `/api/auth/*` にmountし、DrizzleのSQLiteアダプターを通してD1に認証データを保存する。Next.jsはBetter Authのクライアントを利用する。認証スキーマは採用するBetter Authのバージョンから生成し、Drizzle migrationに統合する。D1での実動作はWorkersプレビューで確認する。[Better Auth Hono連携](https://better-auth.com/docs/integrations/hono)、[Better Auth Drizzleアダプター](https://better-auth.com/docs/adapters/drizzle)

## 環境変数

ローカルは `.env` と `.env.example` で管理する。本番は同じ設定名をWorkersのvars／Secretsに設定し、D1はWranglerのbindingで接続する。秘密情報はGitへ入れず、サーバー専用設定を `NEXT_PUBLIC_` で公開しない。

```dotenv
ALLOWED_EMAIL_DOMAINS=company.example
DEFAULT_EXPIRY_DAYS=14
MAX_EXPIRY_DAYS=30
MIN_EXPIRY_DAYS=1
MAX_FILE_BYTES=1048576
MAX_BATCH_FILES=5
MAX_ACTIVE_SHARES_PER_USER=100
APP_BASE_URL=https://sharepages.example
SESSION_TTL_SECONDS=604800
BETTER_AUTH_URL=https://sharepages.example
BETTER_AUTH_SECRET=<secret>
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<secret>
API_ORIGIN=https://api.sharepages.example
```

ドメインはカンマ区切りで複数指定できる。Googleのclient ID／secretとBetter Auth secretを設定する。Googleログインを初期版の唯一の認証方式とし、認証メール送信サービスは必須にしない。

起動・デプロイ時に `1 <= MIN_EXPIRY_DAYS <= DEFAULT_EXPIRY_DAYS <= MAX_EXPIRY_DAYS <= 30` を検証し、不正値はエラーにする。最大30日はコードでも上限を設ける。環境変数で31日以上へ緩めることはできない。

初期期限の設定変更は新規共有に適用する。最大期間を短くする場合は、すでに存在する共有も作成時刻＋新上限で実効期限を短縮し、画面・閲覧判定・削除処理に同じ期限を使う。ドメイン・容量・初期期限等の変更は設定の反映後に適用する。Cronの周期は `.env` ではなくWrangler設定で管理する。

## 保存データと削除処理

主なデータはBetter Authが管理するユーザー・セッション・Googleアカウント・検証データ、アプリ独自の `shares`・`api_keys`・`rate_limits` とする。認証テーブルの実名・構造は公式スキーマ生成結果に合わせ、独自の認証テーブルを重複実装しない。

共有は所有者ID、ランダムslug、タイトル、元ファイル名、種類、サイズ、作成日時、失効日時、状態を保持する。`owner_id`、`slug`、`expires_at` に必要なindexを作る。期限切れ一覧・所有者一覧は全件走査を避ける。

保存中から有効へ遷移するのはD1の本文保存に成功してからとする。削除処理中のレコードは閲覧不可とし、共有メタデータを削除し、外部キーのcascadeで本文も同じ処理で削除する。途中で止まっても同じ処理を安全に再実行できるようにする。期限切れ検証データやセッション、孤立したアップロードも定期清掃する。

## 運用と受け入れ条件

開発・本番のD1、Secretsを分ける。デプロイ手順、migration、環境変数、Google OAuth設定、MCP接続方法をREADMEに記載する。コストはWorkers・D1の使用量を監視し、無料運用を保証条件にはしない。

受け入れ時は次を確認する。

1. 投稿・管理・MCPは会社メールの認証必須。閲覧・ダウンロードはファイルの共有範囲に従い、全員公開のみ匿名で利用できる。
2. 未認証、未許可ドメイン、メール文字列の偽装、他人のID指定では保護データを取得・変更できない。
3. HTML／Markdownを投稿すると有効な共有URLが発行され、スマートフォンでも閲覧できる。
4. 期限未指定は14日。1日と30日は作成可能、0日・31日・不正値はUIとMCPの両方で拒否する。
5. 延長しても作成から30日を超えず、期限境界ではCron未実行でも本文取得が止まる。
6. 手動削除は即時に閲覧不可となり、少量利用時は失効後10分以内に本文と共有メタデータを削除する。
7. 削除失敗の再試行、アップロード途中失敗、期限変更と削除の競合で不正公開や孤立データを残さない。
8. HTMLのスクリプトが親画面の認証情報へアクセスできず、Markdownのスクリプトは実行されない。
9. `.env` のドメイン・初期期限変更を反映でき、不正設定では起動・デプロイを止める。
10. MCP実クライアントで接続から削除まで動作し、認可失効後は呼び出しを拒否する。
11. Bunのlockfileを固定し、Biome、TypeScript、必要な権限・期限・削除のテスト、Workersでの本番ビルドとプレビューを通す。

コミットする場合は `feat: 共有ページのアップロードを追加` のようにprefixを付けた日本語名とする。

## 実装前に決める事項と後続機能

会社のGoogleアカウントによるOAuthの利用可否、Google OAuthアプリ設定、本番ドメイン、Cloudflareアカウント、MCP検証クライアントを実装前に確認する。Better Auth・MCP SDK・Next.js・OpenNextのバージョンは互換性を確認して固定する。30日を暦上の1ヶ月にしたい場合は期限計算を変更する。

パスワード保護、Slack専用プレビュー、通知、ZIP／複数アセット対応、外部CDN許可、本文の編集は後続機能とする。

参考記事はHTML／Markdownのアップロード、期限付き共有、認証、MCP、マイページ等の発想の参照先とする。この記事の72時間・実装構成・運用実績を、本アプリの条件には引き継がない。[参考記事](https://zenn.dev/tokium_dev/articles/tokium-share-pages)

## 実装時に確定した事項

Next.jsはWorkers上の互換性検証により16.3.6へ固定した。16.4.0ではOpenNext 1.20.9のWorkersプレビューにmanifest読み込みエラーがある。MCPはユーザー指定によりOAuthから個人APIキー必須へ変更した。初期版の画面は日本語とし、スマートフォン幅で横方向のはみ出しがないことを確認する。

保存先はユーザー指定によりD1のみへ変更した。1ファイルの上限は1 MiBとし、R2の有効化やバケット作成は不要とする。

## 共有範囲の追加（2026-10-08）

`audience` は university／selected／public。既存ファイルはuniversityを維持する。selectedは会社メールを正規化・重複除去して最大50件保存し、閲覧者には指定先一覧を返さない。publicは匿名の本文・詳細・ダウンロードだけを許可し、投稿・管理・一覧・MCPの認可は従来どおり維持する。共有先解除と公開範囲縮小は次のアクセスから反映し、本文取得後にも再判定する。取得済みの本文は回収できない。

MCPに `update_share_sharing` を追加する。権限はshares:write、所有者限定。APIキーなし・権限不足・他人の共有への変更を拒否する。共有範囲を変えても作成日時・期限は変わらない。

## 表示・閲覧履歴の追加（2026-10-08）

共有ビューはブラウザ表示領域に収め、余白・共通ヘッダー・共通フッターを省く。操作バーはタイトル、詳細、全画面、ダウンロードを基本とする。全画面解除とスマートフォン幅に対応する。投稿画面は大きな紹介カードをなくし入力を中心にする。

成功した本文取得とダウンロードについて閲覧者単位で回数と初回・最終時刻を記録する。本人のアクセスは除外し、ログイン中の会社の利用者は名前・メール、匿名は合計件数のみを表示する。履歴閲覧は投稿者のみ。ファイル削除とともに履歴を削除する。記録開始前の履歴は復元しない。MCPのget_share_viewsでも本人・read権限を検証する。履歴保存の障害で認可済みの本文閲覧を止めない。

## MCP一発設定・ビューの再整理（2026-10-08）

MCP画面でCodex／Claude Code／Claude Desktop／Antigravity／Cursor／VS Code／その他stdioを選択し、OS別コマンドをコピーする。キー発行・クライアント設定・接続ファイルの準備を簡単にする。Node22以降とアプリのインストールは前提。APIキー必須を維持し、秘密値は標準入力と専用ファイルで扱う。既存JSON設定は保持・バックアップし、キーを設定JSONへ直接埋め込まない。OAuth専用のクラウド接続画面は対象外。公式SDKを同梱したstdio bridgeを配布し、clone／npm installを不要にする。

ビューの上部帯を撤去し、右上の小さなアイコンへ操作を集約する。投稿者は閲覧者ポップアップを開ける。閲覧者一覧は従来どおり所有者限定とし、匿名の人物特定はしない。
