"use client";
import { useEffect, useRef, useState } from "react";
import { linksBootstrap } from "@/lib/sandbox-links";
import {
  readEntries,
  STORAGE_CHANNEL,
  saveStorageMessage,
  storageBootstrap,
  storageNamespace,
} from "@/lib/sandbox-storage";

const csp =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";

export function HtmlViewer({
  content,
  title,
  shareId,
  viewerId,
}: {
  content: string;
  title: string;
  shareId: string;
  viewerId: string | null;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    const namespace = storageNamespace(shareId, viewerId);
    const token = crypto.randomUUID();
    let entries = Object.create(null);
    let available = true;
    setStorageError(false);
    try {
      entries = readEntries(window.localStorage, namespace);
    } catch {
      available = false;
      setStorageError(true);
    }
    const fail = () => {
      setStorageError(true);
      frame.current?.contentWindow?.postMessage(
        { channel: STORAGE_CHANNEL, token, op: "error" },
        "*",
      );
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        event.data?.channel !== STORAGE_CHANNEL ||
        event.data.token !== token
      )
        return;
      try {
        saveStorageMessage(
          event,
          frame.current?.contentWindow ?? null,
          token,
          window.localStorage,
          namespace,
        );
      } catch {
        fail();
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (
        event.storageArea !== window.localStorage ||
        (event.key !== null && event.key !== namespace)
      )
        return;
      try {
        frame.current?.contentWindow?.postMessage(
          {
            channel: STORAGE_CHANNEL,
            token,
            op: "sync",
            entries: readEntries(window.localStorage, namespace),
          },
          "*",
        );
      } catch {
        fail();
      }
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
    const bootstrap = storageBootstrap(
      token,
      entries,
      window.location.origin,
      available,
    );
    const links = linksBootstrap(window.location.href);
    setHtml(
      `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><script>${bootstrap}</script><script>${links}</script></head><body>${content}</body></html>`,
    );
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
    };
  }, [content, shareId, viewerId]);
  return (
    <>
      {storageError && (
        <p className="subtle" role="status">
          このブラウザでは保存できません。ブラウザの保存設定や空き容量を確認してください。
        </p>
      )}
      {html && (
        <iframe
          ref={frame}
          className="html-viewer"
          title={title}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          srcDoc={html}
          referrerPolicy="no-referrer"
        />
      )}
    </>
  );
}
