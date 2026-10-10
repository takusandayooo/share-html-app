import { readFile } from "node:fs/promises";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isJSONRPCResponse } from "@modelcontextprotocol/sdk/types.js";

async function main() {
  const path = process.argv[process.argv.indexOf("--config") + 1];
  const config = JSON.parse(await readFile(path, "utf8")) as {
    endpoint: string;
    token: string;
  };
  if (!/^shp_[a-f0-9]{64}$/.test(config.token))
    throw new Error("WebでAPIキーを再発行してください。");
  const remote = new StreamableHTTPClientTransport(new URL(config.endpoint), {
    requestInit: {
      headers: { Authorization: `Bearer ${config.token}` },
      redirect: "error",
    },
  });
  const local = new StdioServerTransport();
  remote.onmessage = (message) => {
    if (
      isJSONRPCResponse(message) &&
      message.result &&
      typeof message.result === "object" &&
      "protocolVersion" in message.result
    )
      remote.setProtocolVersion(String(message.result.protocolVersion));
    void local.send(message);
  };
  local.onmessage = (message) => {
    void remote.send(message).catch(() => {
      if ("id" in message && "method" in message)
        void local.send({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32001,
            message:
              "sharepagesに接続できません。APIキーの期限・失効とネットワークを確認してください。",
          },
        });
    });
  };
  remote.onerror = () => {
    /* Errors are returned without credential details. */
  };
  local.onclose = () => {
    void remote.close();
  };
  await remote.start();
  await local.start();
}
main().catch(() => {
  console.error(
    "sharepagesの接続設定を確認してください。WebでAPIキーを再発行し、接続コマンドを再実行してください。",
  );
  process.exitCode = 1;
});
