"use client";
import type { PublicConfig } from "@share/contracts";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, authClient } from "@/lib/client";
export function useConfig() {
  const [value, setValue] = useState<PublicConfig | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<PublicConfig>("/config")
      .then(setValue)
      .catch((e: Error) => setError(e.message));
  }, []);
  return { config: value, error };
}
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { data: session } = authClient.useSession();
  if (path.startsWith("/p/"))
    return <main className="viewer-shell">{children}</main>;
  return (
    <>
      <header className="header">
        <Link href="/" className="brand">
          <span className="brand-icon">s</span> share
          <span className="brand-light">pages</span>
        </Link>
        <nav aria-label="メインメニュー">
          <Link href="/upload" className={path === "/upload" ? "selected" : ""}>
            共有する
          </Link>
          <Link href="/shares" className={path === "/shares" ? "selected" : ""}>
            マイページ
          </Link>
          <Link href="/shared" className={path === "/shared" ? "selected" : ""}>
            共有されたページ
          </Link>
          <Link href="/keys" className={path === "/keys" ? "selected" : ""}>
            MCP接続
          </Link>
        </nav>
        <div className="account">
          {session ? (
            <>
              <span className="avatar">{session.user.name.slice(0, 1)}</span>
              <button
                type="button"
                className="text-button"
                onClick={() => authClient.signOut()}
              >
                ログアウト
              </button>
            </>
          ) : (
            <span className="campus-badge">投稿は大学限定</span>
          )}
        </div>
      </header>
      <main>{children}</main>
      <footer>
        <span>sharepages</span>

        <span className="footer-links">
          <Link href="/privacy">プライバシー</Link>
          <Link href="/terms">利用規約</Link>
        </span>
      </footer>
    </>
  );
}
export function LoginPanel({ callbackURL }: { callbackURL?: string }) {
  const { config, error } = useConfig();
  const [message, setMessage] = useState("");
  return (
    <section className="login-panel">
      <h2>大学アカウントでログイン</h2>
      <p>
        投稿と大学限定ページの閲覧には、対象の大学Googleアカウントでログインしてください。全員公開のURLはログインなしで閲覧できます。
      </p>
      <button
        type="button"
        className="button google"
        disabled={!config?.authConfigured}
        onClick={async () => {
          const result = await authClient.signIn.social({
            provider: "google",
            callbackURL: callbackURL || window.location.href,
          });
          if (result.error)
            setMessage(result.error.message || "ログインに失敗しました。");
        }}
      >
        <span className="google-letter">G</span>Googleでログイン
      </button>
      <small>
        {config?.allowedEmailDomains.map((d) => `@${d}`).join(" / ") ||
          "大学メール限定"}
      </small>
      {config && !config.authConfigured && (
        <p className="setup-note">
          Googleログインは準備中です。しばらくしてから再度お試しください。
        </p>
      )}
      {(error || message) && (
        <p className="error" role="alert">
          {error || message}
        </p>
      )}
    </section>
  );
}
