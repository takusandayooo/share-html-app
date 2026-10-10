import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
).split("\0");
const rules: [string, RegExp][] = [
  ["個人メール", /[\w.+-]+@gmail\.com/i],
  ["ユーザー名を含むローカルパス", /\/(?:Users|home)\/[a-z0-9_.-]+\//i],
  ["APIキー", /\bshp_[a-f0-9]{64}\b/i],
  ["Googleクライアントシークレット", /\bGOCSPX-[\w-]+/],
  ["秘密鍵", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    "設定ファイルへの秘密情報の直書き",
    /"(?:BETTER_AUTH_SECRET|CONTENT_ENCRYPTION_KEY|GOOGLE_CLIENT_SECRET|CLOUDFLARE_API_TOKEN)"\s*:\s*"[^"\s]+"/,
  ],
];
let issues = 0;
for (const file of new Set(files)) {
  if (
    !file ||
    !existsSync(file) ||
    /\.(png|jpe?g|gif|webp|ico|woff2?|pdf)$/.test(file)
  )
    continue;
  if (
    /(?:^|\/)(?:\.env(?!\.example$|\.production\.example$)|\.dev\.vars|\.secrets|wrangler\.production\.jsonc)/.test(
      file,
    )
  ) {
    console.error(`${file}: 公開対象に非公開設定が含まれています`);
    issues++;
    continue;
  }
  const lines = readFileSync(file, "utf8").split("\n");
  for (const [index, line] of lines.entries())
    for (const [name, pattern] of rules)
      if (pattern.test(line)) {
        console.error(`${file}:${index + 1}: ${name}の候補（値は非表示）`);
        issues++;
      }
}
if (issues) process.exit(1);
console.log(
  "公開対象ファイルの検査成功。Git履歴・画像の内容は別途確認してください。",
);
