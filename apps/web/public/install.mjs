import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const clients = [
  "codex",
  "claude-code",
  "claude-desktop",
  "antigravity",
  "cursor",
  "vscode",
  "other",
];
export function jsonConfigPath(
  client,
  home,
  platform = process.platform,
  appData = process.env.APPDATA,
) {
  if (client === "claude-code") return join(home, ".claude.json");
  if (client === "antigravity")
    return join(home, ".gemini/config/mcp_config.json");
  if (client === "cursor") return join(home, ".cursor/mcp.json");
  if (client === "claude-desktop") {
    if (platform === "darwin")
      return join(
        home,
        "Library/Application Support/Claude/claude_desktop_config.json",
      );
    if (platform === "win32")
      return join(
        appData || join(home, "AppData/Roaming"),
        "Claude/claude_desktop_config.json",
      );
    throw new Error(
      "Claude DesktopはmacOS / Windows向けです。LinuxではClaude Codeを選択してください。",
    );
  }
  return null;
}
export function mergeConfig(source, entry, client) {
  const value = source ? JSON.parse(source) : {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("設定ファイルがJSONオブジェクトではありません。");
  if (
    value.mcpServers &&
    (typeof value.mcpServers !== "object" || Array.isArray(value.mcpServers))
  )
    throw new Error("mcpServersの形式が不正です。");
  const current = value.mcpServers?.sharepages;
  if (
    current &&
    !current.args?.some(
      (arg) => typeof arg === "string" && arg.endsWith("sharepages-bridge.mjs"),
    )
  )
    throw new Error(
      "別のsharepages設定が存在します。既存設定を確認して名前を変更してください。",
    );
  value.mcpServers = {
    ...value.mcpServers,
    sharepages: { ...(client === "cursor" ? { type: "stdio" } : {}), ...entry },
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}
async function privateWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, value, { mode: 0o600 });
  await rename(tmp, path);
  if (process.platform !== "win32") await chmod(path, 0o600);
}
export async function install({
  client,
  endpoint,
  token,
  home = homedir(),
  fetcher = fetch,
  run = spawnSync,
  platform = process.platform,
}) {
  if (!clients.includes(client))
    throw new Error("対応するアプリを選択してください。");
  if (!/^shp_[a-f0-9]{64}$/.test(token))
    throw new Error("APIキーの形式が不正です。");
  const url = new URL(endpoint);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/mcp" ||
    (url.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname))
  )
    throw new Error("MCP接続先のURLが不正です。");
  const response = await fetcher(url, {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "sharepages-installer", version: "1.0.0" },
      },
    }),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "APIキーが失効・期限切れ、または無効です。Webで再発行してください。"
        : "MCPサーバーへの接続を確認できませんでした。",
    );
  const init = await response.json();
  if (!init.result?.protocolVersion)
    throw new Error("MCP初期化に失敗しました。");
  const assets = await fetcher(new URL("/mcp-install-manifest.json", url), {
    redirect: "error",
  });
  if (!assets.ok) throw new Error("接続ファイルの情報を取得できませんでした。");
  const manifest = await assets.json();
  const bridge = await fetcher(new URL("/sharepages-bridge.mjs", url), {
    redirect: "error",
  });
  if (!bridge.ok) throw new Error("接続ファイルを取得できませんでした。");
  const bytes = Buffer.from(await bridge.arrayBuffer());
  if (
    bytes.length > 5 * 1024 * 1024 ||
    createHash("sha256").update(bytes).digest("hex") !== manifest.sha256
  )
    throw new Error("接続ファイルの整合性を確認できませんでした。");
  const dir = join(resolve(home), ".sharepages");
  const bridgePath = join(dir, "sharepages-bridge.mjs");
  const credentials = join(dir, `${client}.json`);
  const entry = {
    command: process.execPath,
    args: [bridgePath, "--config", credentials],
  };
  const configPath = jsonConfigPath(client, home, platform);
  let configSource = "";
  if (configPath) {
    try {
      configSource = await readFile(configPath, "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    // Validate and merge before writing any app configuration.
    mergeConfig(configSource, entry, client);
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (platform !== "win32") await chmod(dir, 0o700);
  await privateWrite(bridgePath, bytes);
  await privateWrite(
    credentials,
    `${JSON.stringify({ endpoint: url.href, token })}\n`,
  );
  if (configPath) {
    if (configSource)
      await privateWrite(
        `${configPath}.sharepages-backup-${Date.now()}`,
        configSource,
      );
    await privateWrite(configPath, mergeConfig(configSource, entry, client));
    return {
      message: `${client}への登録が完了しました。アプリを再起動してMCPを確認してください。`,
      configPath,
    };
  }
  if (client === "other")
    return {
      message: "以下の設定をstdio対応クライアントへ登録してください。",
      config: { mcpServers: { sharepages: entry } },
    };
  let executable, args;
  if (client === "codex") {
    executable = "codex";
    args = ["mcp", "add", "sharepages", "--", entry.command, ...entry.args];
  }
  if (client === "claude-code") {
    executable = "claude";
    args = [
      "mcp",
      "add",
      "--transport",
      "stdio",
      "--scope",
      "user",
      "sharepages",
      "--",
      entry.command,
      ...entry.args,
    ];
  }
  if (client === "vscode") {
    executable = "code";
    args = [
      "--add-mcp",
      JSON.stringify({ name: "sharepages", type: "stdio", ...entry }),
    ];
  }
  if (platform === "win32" && args.some((arg) => /[&|<>^%!\r\n]/.test(arg)))
    throw new Error(
      "パスに特殊文字が含まれています。手動設定を利用してください。",
    );
  if (client === "codex") {
    const existing = run("codex", ["mcp", "get", "sharepages", "--json"], {
      encoding: "utf8",
      shell: platform === "win32",
      windowsHide: true,
    });
    if (existing.status === 0) {
      let current;
      try {
        current = JSON.parse(existing.stdout);
      } catch {
        throw new Error("既存Codex設定の確認に失敗しました。");
      }
      if (
        current.transport?.args?.includes(bridgePath) &&
        current.transport?.args?.includes(credentials)
      )
        return {
          message:
            "Codexの接続キーを更新しました。アプリを再起動してください。",
        };
      throw new Error(
        "別のsharepages設定がCodexに存在します。既存設定を確認してください。",
      );
    }
  }
  const result = run(executable, args, {
    encoding: "utf8",
    shell: platform === "win32",
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    return {
      message: `${executable} CLIで登録できませんでした。CLIをインストールして再実行するか、以下を手動登録してください。既存サーバーがある場合はその設定を確認してください。`,
      config: { mcpServers: { sharepages: entry } },
      manual: true,
    };
  return {
    message: `${client}への登録が完了しました。アプリを再起動してMCPを確認してください。`,
  };
}
async function main() {
  if (Number(process.versions.node.split(".")[0]) < 22)
    throw new Error("Node.js 22以降をインストールしてください。");
  const args = process.argv.slice(2);
  const option = (name) => args[args.indexOf(name) + 1];
  if (!args.includes("--token-stdin"))
    throw new Error("APIキーは --token-stdin で標準入力から渡してください。");
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 256) throw new Error("APIキーの入力が長すぎます。");
  }
  const result = await install({
    client: option("--client"),
    endpoint: option("--endpoint"),
    token: input.trim(),
  });
  console.log(result.message);
  if (result.configPath) console.log(`設定ファイル：${result.configPath}`);
  if (result.config) console.log(JSON.stringify(result.config, null, 2));
  if (result.manual) process.exitCode = 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    console.error(
      "設定に失敗しました。接続先、キー、アプリのCLI・設定ファイル形式を確認してください。既存の設定は自動削除しません。",
    );
    process.exitCode = 1;
  });
