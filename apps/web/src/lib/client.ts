"use client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient({
  plugins: [oauthProviderClient()],
});
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.message || data.error_description || "通信に失敗しました。",
    );
  return data as T;
}
export function datetime(iso: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}
export function remaining(iso: string) {
  const days = Math.ceil((Date.parse(iso) - Date.now()) / 86400000);
  return days <= 0 ? "期限切れ" : `残り${days}日`;
}
