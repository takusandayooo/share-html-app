<div align="center">
  <img src="apps/web/src/app/icon.svg" width="88" alt="Sharepagesのアイコン">
  <h1>Sharepages</h1>
  <p><strong>作ったページを、URLひとつで届ける。</strong></p>
  <p>
    <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&amp;logo=typescript&amp;logoColor=white" alt="言語：TypeScript">
    <img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&amp;logo=nextdotjs&amp;logoColor=white" alt="画面：Next.js">
    <img src="https://img.shields.io/badge/Hono-E36002?style=for-the-badge&amp;logo=hono&amp;logoColor=white" alt="API：Hono">
    <img src="https://img.shields.io/badge/Bun-000000?style=for-the-badge&amp;logo=bun&amp;logoColor=white" alt="依存管理：Bun">
  </p>
  <p>
    <img src="https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&amp;logo=cloudflare&amp;logoColor=white" alt="実行環境：Cloudflare Workers">
    <img src="https://img.shields.io/badge/Cloudflare_D1-F38020?style=for-the-badge&amp;logo=cloudflare&amp;logoColor=white" alt="データベース：Cloudflare D1">
  </p>
</div>

**HTMLやMarkdownをアップロードし、共有する相手と期限を選んで届けるアプリです。**

AIで作ったレポートや小さなツールを、相手にも使ってもらいたい。ファイルを送る代わりに、ブラウザで開けるURLを渡す。Sharepagesでは、Codexからの依頼でも、ブラウザからのアップロードでも、そのままのページを共有できます。

**[使い方](docs/USAGE.md) · [セットアップ](docs/SETUP.md) · [技術構成と開発ガイド](docs/DEVELOPMENT.md)**

## 作ったものを、すぐに見てもらう

HTMLで作った資料、Markdownのメモ、ブラウザで動く小さなツール。完成したファイルを共有すると、相手はURLを開くだけで内容を見られます。

共有のたびにサーバーを用意したり、サイトをデプロイしたりする手間を減らし、作ったものを見せるところまでつなげます。

## Codexに頼んで、URLを受け取る

SharepagesをCodexに接続しておけば、会話の中から共有できます。

> このHTMLをSharepagesで共有して、URLを教えて。

1. 大学GoogleアカウントでSharepagesにログインする。
2. 「MCP接続」でCodexを選び、APIキーを発行する。
3. 接続コマンドを実行し、Codexを再起動する。
4. 共有したいファイルを指定して依頼する。

**通常はCodexのAPIキー接続を使います。** ChatGPT・Dots向けのOAuth接続は、必要な場合だけ設定する任意の機能です。詳しくは[AIアプリからの使い方](docs/USAGE.md#codexから共有する)を参照してください。

## 誰に、いつまで見せるかを選ぶ

| 共有先 | 届けられる相手 |
| --- | --- |
| 大学内でURL共有 | 対象大学のアカウントを持ち、URLを知っている人 |
| 指定した大学メールだけ | 自分と、指定した相手 |
| 全員にURL公開 | URLを知っている全員。ログイン不要 |

公開期間は標準14日、最大30日。マイページから期限や共有先を変更し、共有を取り消すこともできます。期限になると、そのURLからの閲覧とダウンロードが止まります。

## 共有を支える機能

| 機能 | できること |
| --- | --- |
| HTML・Markdown共有 | ファイルをアップロードして、ブラウザで開けるURLを発行 |
| AIアプリとの連携 | Codexなどから共有を作成し、期限や共有先を変更 |
| マイページ | 自分の共有を一覧で確認し、変更・削除 |
| 共有されたページ | メール指定で受け取った共有を一覧で確認 |
| 閲覧履歴 | 投稿者が閲覧・ダウンロードの履歴を確認 |
| HTMLの操作 | ページ内リンク・外部リンク・ブラウザ内の保存に対応 |

HTMLは画像・CSS・スクリプトを含む1ファイルで用意してください。標準設定では、1ファイル1 MiBまで、同時に5件まで共有できます。外部ファイルへの依存や保存の制約は[使い方](docs/USAGE.md)・[技術ガイド](docs/DEVELOPMENT.md)にまとめています。

## まず試す操作

1. 自分の大学Googleアカウントでログインする。
2. 「共有する」からHTMLまたはMarkdownを選ぶ。
3. 共有先と期限を設定し、発行されたURLを開く。
4. マイページで共有先や期限を変更する。
5. Codexからも使う場合は、MCP接続を設定して共有を依頼する。

サービスを自分の環境で動かす場合は、[セットアップ](docs/SETUP.md)を参照してください。許可する大学ドメインは運営者が設定します。

## 保存とプライバシー

- 投稿・管理にはGoogleログインを使い、対象の大学アカウントを確認します。
- 共有ファイルの本文は暗号化して保存します。保存範囲と管理者権限の扱いは[技術ガイド](docs/DEVELOPMENT.md#本文の暗号化)に記載しています。
- 共有する相手と公開期間は、ファイルごとに選べます。
- 期限後は閲覧できなくなり、共有データは定期的に削除されます。
- 相手が取得・ダウンロードした内容は回収できません。必要な原本は手元にも保存してください。

実アカウントの情報・大学ドメイン・公開サービスのURL・認証情報は、公開ソースには含めていません。設定例は自分の環境に置き換えて使ってください。

## セットアップ・開発資料

| 知りたいこと | ドキュメント |
| --- | --- |
| ブラウザ・Codexから共有する | [使い方](docs/USAGE.md) |
| ローカル起動・Googleログイン・デプロイ | [セットアップ](docs/SETUP.md) |
| 使用技術・構成・認証・暗号化・テスト | [技術構成と開発ガイド](docs/DEVELOPMENT.md) |
| Google Cloud側の認証設定 | [Googleログイン設定](docs/google-oauth-setup.md) |
| 機能の詳細な要件 | [要件](docs/requirements.md) |
