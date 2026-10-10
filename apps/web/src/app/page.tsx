"use client";
import Link from "next/link";
import { useConfig } from "@/components/shell";
export default function Home() {
  const { config } = useConfig();
  return (
    <div className="page home-page">
      <section className="home-hero">
        <span className="home-label">HTML / Markdown の共有</span>
        <h1>
          作ったページを、
          <br />
          URLひとつで届ける。
        </h1>
        <p>
          HTMLやMarkdownをアップロードするだけ。
          <br />
          相手はブラウザで開けます。共有先と期限は、あなたが選べます。
        </p>
        <div className="actions">
          <Link className="button primary" href="/upload">
            ファイルを共有する →
          </Link>
          <Link className="button secondary" href="/keys">
            AIから共有する
          </Link>
        </div>
        <small>投稿には会社のGoogleアカウントでのログインが必要です。</small>
      </section>
      <section className="home-section">
        <h2>sharepagesでできること</h2>
        <div className="home-features">
          <article>
            <span className="home-feature-icon">↗</span>
            <h3>ファイルが、そのままページに</h3>
            <p>
              HTMLの見た目や動きをブラウザで表示。Markdownも読みやすいページになります。相手にファイルをダウンロードしてもらう必要はありません。
            </p>
          </article>
          <article>
            <span className="home-feature-icon">◎</span>
            <h3>共有する相手を選べる</h3>
            <p>
              大社内のURL共有、指定した会社メール、全員にURL公開。用途に合わせて選び、作成後も変更できます。
            </p>
          </article>
          <article>
            <span className="home-feature-icon">◷</span>
            <h3>必要な期間だけ共有</h3>
            <p>
              標準{config?.defaultExpiryDays ?? 14}日、作成から最大
              {config?.maxExpiryDays ?? 30}
              日。期限後は閲覧できなくなり、ファイルは自動で削除されます。
            </p>
          </article>
        </div>
      </section>
      <section className="home-section home-how">
        <h2>共有は3ステップ</h2>
        <ol>
          <li>
            <span>1</span>
            <div>
              <h3>会社アカウントでログイン</h3>
              <p>Googleログインで、あなたの会社メールを確認します。</p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <h3>ファイル・共有先・期限を選ぶ</h3>
              <p>HTMLまたはMarkdownを選択。共有範囲と公開期間を設定します。</p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <h3>URLをコピーして届ける</h3>
              <p>
                URLを送るだけ。全員にURL公開したページは、社外の人もログインなしで開けます。
              </p>
            </div>
          </li>
        </ol>
      </section>
      <section className="home-section">
        <h2>共有先に合わせた、3つの公開範囲</h2>
        <div className="home-sharing">
          <article>
            <h3>大社内でURL共有</h3>
            <p>URLを知っている対象会社のGoogleアカウント全員が閲覧できます。</p>
            <small>閲覧にはログインが必要</small>
          </article>
          <article>
            <h3>指定した会社メールだけ</h3>
            <p>
              投稿者と指定した相手だけが閲覧できます。相手の「共有されたページ」にも表示します。
            </p>
            <small>最大50人 · 閲覧にはログインが必要</small>
          </article>
          <article>
            <h3>全員にURL公開</h3>
            <p>
              URLを知っている全員が閲覧できます。会社の外の人にも共有できます。
            </p>
            <small>閲覧はログイン不要</small>
          </article>
        </div>
      </section>
      <section className="home-ai">
        <div>
          <span className="home-label">AIからも、そのまま</span>
          <h2>「このHTMLを共有して」で、URLへ。</h2>
          <p>
            Codex、Claude Code、Claude Desktop、Antigravity、Cursor、VS
            CodeなどのローカルMCP対応アプリから共有できます。個人APIキーを発行し、アプリ別の接続コマンドを一度実行して設定します。
          </p>
          <small>Node.js 22以降と対応アプリが必要です。</small>
        </div>
        <Link className="button secondary" href="/keys">
          MCPを設定する →
        </Link>
      </section>
      <section className="home-section home-faq">
        <h2>使う前に知っておきたいこと</h2>
        <details>
          <summary>どんなファイルを共有できますか？</summary>
          <p>
            自己完結したUTF-8のHTML・Markdownに対応します。1ファイル最大
            {Math.round((config?.maxFileBytes ?? 1048576) / 1048576)}{" "}
            MiB、一度に{config?.maxBatchFiles ?? 5}
            ファイル。別ファイルの画像・CSSや外部CDNへの参照には対応していません。
          </p>
        </details>
        <details>
          <summary>共有した後も管理できますか？</summary>
          <p>
            マイページから期限・共有先の変更と削除ができます。閲覧履歴は投稿者だけが確認でき、ログイン済みの閲覧者は名前とメール、匿名のアクセスは件数を表示します。取得済みの内容は回収できません。
          </p>
        </details>
        <details>
          <summary>共有メールは自動で届きますか？</summary>
          <p>
            通知メールは送信しません。共有URLをコピーして、メールやチャットで相手に渡してください。
          </p>
        </details>
      </section>
      <section className="home-start">
        <h2>まずは、ひとつ共有してみましょう。</h2>
        <Link className="button primary" href="/upload">
          ファイルを共有する →
        </Link>
      </section>
    </div>
  );
}
