/** Navigate only to the server-validated OAuth callback or our own flow. */
export function oauthRedirectTarget(
  result: { redirect?: boolean; url?: string },
  oauthQuery: string,
  origin: string,
): string {
  if (!result.redirect || !result.url)
    throw new Error(
      "連携を続けられませんでした。接続元からやり直してください。",
    );
  const target = new URL(result.url, origin);
  if (
    target.origin === origin &&
    (target.pathname.startsWith("/oauth/") ||
      target.pathname.startsWith("/api/auth/oauth2/"))
  )
    return target.href;
  const callback = new URLSearchParams(oauthQuery).get("redirect_uri");
  if (callback) {
    const expected = new URL(callback);
    if (
      target.protocol === "https:" &&
      target.origin === expected.origin &&
      target.pathname === expected.pathname
    )
      return target.href;
  }
  throw new Error(
    "連携先の戻り先を確認できませんでした。接続元からやり直してください。",
  );
}

export const oauthScopeLabels: Record<string, string> = {
  "shares:read": "あなたが作成した共有ページの情報・閲覧履歴を取得する",
  "shares:write": "ページを作成し、期限や共有先を変更する",
  "shares:delete": "あなたが作成したページを削除する",
  offline_access: "ログイン画面を開き直さず、許可した操作を継続する",
};
