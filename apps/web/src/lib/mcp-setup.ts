export const mcpClients = [
  {
    id: "codex",
    name: "Codex",
    help: "Codex CLIをインストール済みなら、CLI・デスクトップ・IDEで使うローカルMCP設定へ登録します。",
    docs: "https://learn.chatgpt.com/docs/extend/mcp?surface=cli",
  },
  {
    id: "claude-code",
    name: "Claude Code",
    help: "Claude Codeのユーザー設定へ登録します。",
    docs: "https://code.claude.com/docs/en/mcp",
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    help: "macOS / WindowsのClaude Desktop設定へ登録します。",
    docs: "https://modelcontextprotocol.io/docs/develop/connect-local-servers",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    help: "AntigravityのグローバルMCP設定へ登録します。",
    docs: "https://antigravity.google/docs/mcp",
  },
  {
    id: "cursor",
    name: "Cursor",
    help: "CursorのグローバルMCP設定へ登録します。",
    docs: "https://cursor.com/docs/mcp",
  },
  {
    id: "vscode",
    name: "VS Code",
    help: "code CLIからユーザープロファイルへ登録します。",
    docs: "https://code.visualstudio.com/docs/agent-customization/mcp-servers",
  },
  {
    id: "other",
    name: "その他（stdio）",
    help: "接続ファイルを用意し、登録用JSONをターミナルに表示します。",
    docs: "https://modelcontextprotocol.io/docs/develop/connect-local-servers",
  },
] as const;
export type McpClientId = (typeof mcpClients)[number]["id"];
export function installCommand(
  client: McpClientId,
  os: "unix" | "windows",
  endpoint: string,
  token: string,
) {
  if (!mcpClients.some((item) => item.id === client))
    throw new Error("アプリを選択してください。");
  if (token !== "YOUR_API_KEY" && !/^shp_[a-f0-9]{64}$/.test(token))
    throw new Error("APIキーを発行してください。");
  const url = new URL(endpoint);
  if (
    (url.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/mcp"
  )
    throw new Error("公開MCPの接続先が不正です。");
  const q = (value: string) =>
    `'${value.replace(/'/g, os === "unix" ? `'"'"'` : "''")}'`;
  const installer = new URL("/install.mjs", url).href;
  if (os === "windows")
    return `& { $sharepagesInstaller = Join-Path $env:TEMP ('sharepages-' + [guid]::NewGuid().ToString() + '.mjs'); Invoke-WebRequest -Uri ${q(installer)} -OutFile $sharepagesInstaller -ErrorAction Stop; ${q(token)} | node $sharepagesInstaller --client ${q(client)} --endpoint ${q(url.href)} --token-stdin }`;
  return `sharepages_tmp="$(mktemp -d)" && curl -fsSL ${q(installer)} -o "$sharepages_tmp/install.mjs" && printf '%s\n' ${q(token)} | node "$sharepages_tmp/install.mjs" --client ${q(client)} --endpoint ${q(url.href)} --token-stdin`;
}
