import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  install,
  jsonConfigPath,
  mergeConfig,
} from "../apps/web/public/install.mjs";
import { installCommand, mcpClients } from "../apps/web/src/lib/mcp-setup";

const token = `shp_${"a".repeat(64)}`;
const endpoint = "https://sharepages.example.com/mcp";
test("OS commands use stdin, quote arguments, and cover all advertised clients", () => {
  for (const client of mcpClients)
    for (const os of ["unix", "windows"] as const) {
      const command = installCommand(client.id, os, endpoint, token);
      expect(command).toContain("--token-stdin");
      expect(command).toContain(client.id);
      expect(command).not.toContain("--token ");
    }
  expect(() =>
    installCommand("codex", "unix", "http://evil.example/mcp", token),
  ).toThrow();
  expect(() =>
    installCommand("codex", "unix", endpoint, "$(touch /tmp/bad)"),
  ).toThrow();
});
test("installer preserves existing settings, backs up, keeps token separate, verifies bridge integrity", async () => {
  const home = await mkdtemp(join(tmpdir(), "sharepages-install-test-"));
  const bytes = Buffer.from("// bridge fixture");
  const fetcher = (async (url: URL | string, options?: RequestInit) => {
    const target = String(url);
    if (target.endsWith("/mcp")) {
      expect(new Headers(options?.headers).get("Authorization")).toBe(
        `Bearer ${token}`,
      );
      expect(options?.redirect).toBe("error");
      return Response.json({ result: { protocolVersion: "2025-11-25" } });
    }
    if (target.endsWith("manifest.json"))
      return Response.json({
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    return new Response(bytes);
  }) as typeof fetch;
  try {
    for (const client of [
      "claude-code",
      "claude-desktop",
      "antigravity",
      "cursor",
    ]) {
      const path = jsonConfigPath(client, home, "darwin");
      if (!path) throw new Error("Expected config path");
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(
        path,
        JSON.stringify({
          theme: "keep",
          mcpServers: { existing: { command: "keep" } },
        }),
      );
      const result = await install({
        client,
        endpoint,
        token,
        home,
        platform: "darwin",
        fetcher,
      });
      expect(result.configPath).toBe(path);
      const text = await readFile(path, "utf8");
      expect(text).not.toContain(token);
      const config = JSON.parse(text);
      expect(config.theme).toBe("keep");
      expect(config.mcpServers.existing.command).toBe("keep");
      expect(
        (await stat(join(home, ".sharepages", `${client}.json`))).mode & 0o777,
      ).toBe(0o600);
    }
    const calls: Array<[string, string[]]> = [];
    const run = ((cmd: string, args: string[]) => {
      calls.push([cmd, args]);
      return { status: args.includes("get") ? 1 : 0, stdout: "" };
    }) as never;
    await install({ client: "codex", endpoint, token, home, fetcher, run });
    expect(calls.at(-1)?.[1].slice(0, 3)).toEqual(["mcp", "add", "sharepages"]);
    expect(JSON.stringify(calls)).not.toContain(token);
    const badFetcher = (async (url: URL | string, options?: RequestInit) =>
      String(url).endsWith("manifest.json")
        ? Response.json({ sha256: "bad" })
        : fetcher(url, options)) as typeof fetch;
    await expect(
      install({ client: "cursor", endpoint, token, home, fetcher: badFetcher }),
    ).rejects.toThrow();
    expect(() =>
      mergeConfig(
        '{"mcpServers":{"sharepages":{"command":"different"}}}',
        { command: "node", args: [] },
        "cursor",
      ),
    ).toThrow();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
