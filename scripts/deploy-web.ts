import { readFileSync } from "node:fs";

const source = readFileSync(".env.production", "utf8");
const origin = source
  .match(/^API_ORIGIN=(.+)$/m)?.[1]
  .trim()
  .replace(/^["']|["']$/g, "");
if (!origin || new URL(origin).protocol !== "https:")
  throw new Error("Set production API_ORIGIN first");
const bridge = Bun.spawnSync(["bun", "run", "build:mcp-installer"], {
  stdout: "inherit",
  stderr: "inherit",
});
if (bridge.exitCode !== 0) process.exit(bridge.exitCode);
const build = Bun.spawnSync(
  ["bun", "--no-env-file", "run", "build:cloudflare"],
  {
    cwd: "apps/web",
    env: { ...process.env, API_ORIGIN: origin, NODE_ENV: "production" },
    stdout: "inherit",
    stderr: "inherit",
  },
);
if (build.exitCode !== 0) process.exit(build.exitCode);
// Deploy the bundle directly with Wrangler. OpenNext's deploy env loader can
// pick up a D1-only token from the root .env.production and replace OAuth login.
// Intentionally exported credentials are still honored.
const result = Bun.spawnSync(
  [
    "node",
    "node_modules/wrangler/bin/wrangler.js",
    "deploy",
    "--config",
    "wrangler.production.jsonc",
  ],
  {
    cwd: "apps/web",
    env: { ...process.env, API_ORIGIN: origin },
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exit(result.exitCode);
