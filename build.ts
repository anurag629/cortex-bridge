// Bundles the plugin and the installer CLI into single self-contained files
// under dist/. The plugin has zero runtime dependencies (only global fetch),
// so the output is a standalone ESM file OpenCode can auto-discover.
import { rename, chmod } from "node:fs/promises"
import { existsSync } from "node:fs"

async function build(entry: string, outName: string, banner?: string) {
  const res = await Bun.build({
    entrypoints: [entry],
    outdir: "dist",
    target: "node",
    format: "esm",
    banner,
  })
  if (!res.success) {
    for (const m of res.logs) console.error(m)
    process.exit(1)
  }
  const produced = entry.split("/").pop()!.replace(/\.ts$/, ".js")
  if (produced !== outName && existsSync(`dist/${produced}`)) {
    await rename(`dist/${produced}`, `dist/${outName}`)
  }
}

await build("src/plugin.ts", "cognee.plugin.js")
await build("src/install.ts", "install.js", "#!/usr/bin/env bun")
await chmod("dist/install.js", 0o755)
console.log("built dist/cognee.plugin.js and dist/install.js")
