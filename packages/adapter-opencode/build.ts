// Bundles the plugin and the installer CLI into single self-contained files
// under dist/. The plugin has zero runtime dependencies (only global fetch),
// so the output is a standalone ESM file OpenCode can auto-discover.
import { rename, chmod } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"

// Resolve paths relative to this file so the build works from any cwd (it is
// run from the repo root via `bun run packages/adapter-opencode/build.ts`).
const root = import.meta.dir
const outdir = join(root, "dist")

async function build(entry: string, outName: string, banner?: string) {
  const res = await Bun.build({
    entrypoints: [join(root, entry)],
    outdir,
    target: "node",
    format: "esm",
    banner,
  })
  if (!res.success) {
    for (const m of res.logs) console.error(m)
    process.exit(1)
  }
  const produced = entry.split("/").pop()!.replace(/\.ts$/, ".js")
  if (produced !== outName && existsSync(join(outdir, produced))) {
    await rename(join(outdir, produced), join(outdir, outName))
  }
}

await build("src/plugin.ts", "cognee.plugin.js")
await build("src/install.ts", "install.js", "#!/usr/bin/env bun")
await chmod(join(outdir, "install.js"), 0o755)
console.log("built dist/cognee.plugin.js and dist/install.js")
