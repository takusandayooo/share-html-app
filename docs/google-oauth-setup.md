# sharepages Googleログイン設定

ここではGoogleによる会社アカウントのログインを設定します。ChatGPT・Dotsへ操作権限を渡すOAuth接続とは別の設定です。URLと会社ドメインは例なので、ご自身の環境に置き換えてください。

## Google Cloudで設定する内容

1. 自分の管理用GoogleアカウントでGoogle Cloudのプロジェクトを作成します。
2. Google Auth Platformでアプリ名・連絡先・公開対象を設定します。テスト中の場合、必要な会社アカウントをテストユーザーへ追加します。
3. 会社のGoogle Workspaceで外部アプリが制限されている場合、管理者の許可を確認します。
4. OAuthクライアントを「ウェブアプリケーション」として作成します。
5. 権限は `openid`・`email`・`profile` のみに限定します。
6. 公開Webのoriginと、次のリダイレクトURIを登録します。

```text
https://sharepages.example/api/auth/callback/google
```

ローカル検証用には次のURIを追加します。

```text
http://localhost:3000/api/auth/callback/google
```

Googleのclient IDとclient secretを取得します。[Better Auth公式のGoogle設定手順](https://www.better-auth.com/docs/authentication/google)

## 本番API Workerへ登録

プロジェクトルートで非秘密設定を `.env.production` に記入し、Wrangler設定を生成します。生成された設定はGit対象外です。

```sh
cd <project-directory>
bun run prepare:deploy
cd apps/api
bunx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.production.jsonc
bunx wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.production.jsonc
```

各コマンドの対話入力に値を入れます。資格情報をコマンド引数・公開設定・チャット・Gitへ保存しないでください。`prepare:deploy` はSecrets用ファイルを生成しません。

公開ページを再読み込みし、Googleログインボタンが有効になったことを確認します。対象会社メールでログインし、共有・閲覧・MCP接続を試してください。Google情報の変更だけならWebの再ビルドは不要です。

## ローカルでの検証

Git対象外の `.env` に開発用の `GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET` を設定し、`bun run setup:env` を実行して開発サーバーを再起動します。本番と開発ではクライアントおよびSecretsを分けてください。

Googleログインの成功、会社のGoogle Workspaceに対する制限、OAuthの公開状態を自分の環境で確認してください。個別環境の管理メール・テストユーザー・アカウントIDなどは公開リポジトリに記録しません。
