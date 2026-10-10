import { createHash } from "node:crypto";

const result = await Bun.build({
  entrypoints: ["apps/api/scripts/mcp-bridge.ts"],
  outdir: "apps/web/public",
  naming: "sharepages-bridge.mjs",
  target: "node",
  format: "esm",
  minify: true,
});
if (!result.success) throw new Error("MCP bridge build failed");
const bytes = await Bun.file(
  "apps/web/public/sharepages-bridge.mjs",
).arrayBuffer();
await Bun.write(
  "apps/web/public/mcp-install-manifest.json",
  `${JSON.stringify(
    {
      version: "1.0.0",
      sha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
    },
    null,
    2,
  )}\n`,
);
