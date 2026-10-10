"use client";
import type { Share } from "@share/contracts";
export const audienceLabel = (audience: Share["audience"]) =>
  ({
    university: "大社内でURL共有",
    selected: "指定した会社メールだけ",
    public: "全員にURL公開",
  })[audience];
export function recipientEmails(value: string) {
  return [
    ...new Set(
      value
        .split(/[\s,、;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
}
export function SharingFields({
  audience,
  recipients,
  onAudience,
  onRecipients,
  disabled = false,
}: {
  audience: Share["audience"];
  recipients: string;
  onAudience: (value: Share["audience"]) => void;
  onRecipients: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="sharing-fields" disabled={disabled}>
      <legend>共有先</legend>
      <label>
        閲覧できる人
        <select
          value={audience}
          onChange={(e) => onAudience(e.target.value as Share["audience"])}
        >
          <option value="university">大社内でURL共有</option>
          <option value="selected">指定した会社メールだけ</option>
          <option value="public">全員にURL公開</option>
        </select>
      </label>
      {audience === "selected" && (
        <label>
          共有先の会社メール
          <textarea
            value={recipients}
            onChange={(e) => onRecipients(e.target.value)}
            placeholder="employee@company.example"
            rows={3}
            maxLength={13000}
          />
          <small>
            改行またはカンマ区切りで最大50人。相手は会社のGoogleアカウントでログインして閲覧します。メール通知は送信されません。
          </small>
        </label>
      )}
      <p className={audience === "public" ? "public-sharing-note" : "hint"}>
        {audience === "public"
          ? "このURLを知っている全員が、ログインなしで閲覧・ダウンロードできます。URLを受け取った人から再共有される場合もあります。"
          : audience === "selected"
            ? "投稿者と指定した相手だけが閲覧できます。共有先は後から変更できます。"
            : "このURLを知っている対象会社のアカウント全員が閲覧できます。"}
      </p>
    </fieldset>
  );
}
