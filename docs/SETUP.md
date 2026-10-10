# セットアップ

[サービス紹介](../README.md) · [使い方](USAGE.md) · [セットアップ](SETUP.md) · [技術構成と開発ガイド](DEVELOPMENT.md)

自分の環境でSharepagesを動かすための手順です。URLと識別子は例示用で、実際の値はGit対象外の環境設定で管理します。

## ローカル起動

Node.js 22以上、Bun 1.3以上が必要です。Bunで依存管理し、Next.js／Wrangler CLIはNode.jsで実行します。Wranglerに `--bun` を付けないでください。

```sh
bun install --frozen-lockfile
bun run setup:env
bun run db:migrate
bun run dev
```

`.env.example` から `.env` を作り、`setup:env` がランダムなBetter Auth secretとアプリ別の設定ファイルを生成します。Google設定が未入力でも画面・APIは起動しますが、ログインボタンは無効です。認証を迂回する開発用ログインはありません。

標準URLは `http://localhost:3000`、APIは8787番です。別のサービスと競合する場合は、`.env` の `APP_BASE_URL` でポートを変更します。`setup:env` が画面のPORTも同期します。ポート変更時はGoogle callback URLも合わせてください。

`.env` を変更したら `bun run setup:env` を再実行して開発サーバーを再起動します。Bunの一括起動で問題がある場合は、別ターミナルで `bun run --filter @share/api dev` と `bun run --filter @share/web dev` を実行します。

## Googleログイン

Google Cloud ConsoleでWeb application用OAuthクライアントを作り、OAuth同意画面と次のredirect URIを設定します。

```text
http://localhost:3000/api/auth/callback/google
https://<公開ドメイン>/api/auth/callback/google
```

`.env` の `GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET` を設定して、`bun run setup:env` を実行します。ログイン後のGoogleプロフィールで確認済みメールとドメインを検証します。初期の許可ドメインは `students.university.example` と `university.example`。登録・再ログイン・API・MCPキー認証でチェックします。

大学のGoogle Workspace側で外部OAuthアプリが制限されている場合は、大学管理者による許可が必要です。Googleログインの実際の完了には、有効なOAuth credentialsと大学アカウントが必要です。

## Cloudflareへデプロイ

実行にはCloudflareアカウントへのログインと公開ドメインが必要です。以下のURLや識別子は例で、ご自身の環境へ置き換えてください。

1. `wrangler login` を実行し、D1を作成します。R2の有効化・作成は不要です。
2. `.env.production.example` を `.env.production` へコピーし、公開URLとAPI WorkerのHTTPS URLなどの非秘密設定を指定します。秘密値は後述の対話入力でWorkersへ登録します。
3. `.env.production` に対象の `CLOUDFLARE_ACCOUNT_ID`、`D1_DATABASE_ID` を追加します。アカウントIDを明示しない本番設定は生成できません。
4. `bun run prepare:deploy` を実行します。設定値を検証し、Git対象外の本番Wrangler設定のみ生成します。Secrets用のファイルは生成しません。
5. APIのmigration、Secrets登録、デプロイを行います。
6. Webを本番設定でビルド・デプロイします。

```sh
cd apps/api
bunx wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc
bunx wrangler secret put BETTER_AUTH_SECRET --config wrangler.production.jsonc
bunx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.production.jsonc
bunx wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.production.jsonc
bunx wrangler secret put CONTENT_ENCRYPTION_KEY --config wrangler.production.jsonc
bunx wrangler deploy --config wrangler.production.jsonc
cd ../..
bun run deploy:web
```

`API_ORIGIN` は `https://api.sharepages.example` のようなAPI Worker専用URL、`APP_BASE_URL` はWebの公開URLです。API_ORIGINとAPP_BASE_URLを同じ値にするとproxyがループするため拒否します。Google callback URIはAPP_BASE_URLの `/api/auth/callback/google` です。

`deploy:web` は `.env.production` のAPI_ORIGINをプロセス環境へ明示してビルドするため、ローカル用 `.env` の値を本番へ持ち込みません。本番設定は `prepare:deploy` が作成します。生成された本番設定と `.env*` はGit対象外です。Secretsは `wrangler secret put` の対話入力で登録し、ファイル・コマンド引数・Gitへ保存しません。

DBは開発と本番で分離します。公開ドメインをWeb Workerへ割り当てた後、APP_BASE_URLとGoogle callbackを一致させてください。CronはAPI側Workerに登録しています。

Google Cloud側の詳しい設定は[Googleログイン設定](google-oauth-setup.md)を参照してください。
