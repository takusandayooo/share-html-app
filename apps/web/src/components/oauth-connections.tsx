"use client";

import { useCallback, useEffect, useState } from "react";
import { api, datetime } from "@/lib/client";
import { oauthScopeLabels } from "@/lib/oauth-navigation";

type OAuthConnection = {
  id: string;
  clientName: string;
  clientId: string;
  scopes: string[];
  createdAt: string | null;
};

export function OAuthConnections() {
  const [connections, setConnections] = useState<OAuthConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<OAuthConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const value = await api<{ items: OAuthConnection[] }>(
        "/oauth/connections",
      );
      setConnections(value.items);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "連携を取得できませんでした。",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const revoke = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await api(`/oauth/connections/${encodeURIComponent(selected.id)}`, {
        method: "DELETE",
      });
      setNotice(`「${selected.clientName}」との連携を解除しました。`);
      setSelected(null);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "連携を解除できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="table-card">
      <div className="section-row">
        <h2>OAuthで連携中のアプリ</h2>
        <span className="count">{connections.length}件</span>
      </div>
      {loading ? (
        <p>読み込み中…</p>
      ) : connections.length === 0 ? (
        <p className="subtle">OAuthで連携しているアプリはありません。</p>
      ) : (
        connections.map((connection) => (
          <div className="key-row" key={connection.id}>
            <div>
              <strong>{connection.clientName}</strong>
              <small className="oauth-client-id">{connection.clientId}</small>
              {connection.createdAt && (
                <small>{datetime(connection.createdAt)}に許可</small>
              )}
              <small>
                {connection.scopes
                  .map((scope) => oauthScopeLabels[scope] || scope)
                  .join(" / ")}
              </small>
            </div>
            <button
              type="button"
              className="text-button danger"
              onClick={() => setSelected(connection)}
            >
              連携解除
            </button>
          </div>
        ))
      )}
      {selected && (
        <div className="edit-panel">
          <h3>「{selected.clientName}」との連携を解除しますか？</h3>
          <p>
            このアプリからの操作ができなくなります。再び使うには、接続元からログインして許可してください。
          </p>
          <div className="actions">
            <button
              type="button"
              className="button destructive"
              disabled={busy}
              onClick={revoke}
            >
              {busy ? "解除中…" : "連携を解除する"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
