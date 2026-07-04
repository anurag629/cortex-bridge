// Bundles the Claude Code hook entry and the installer into single self-contained
// files under dist/. The hooks run via `bun dist/hook.js <mode>`. Resolves paths
// relative to this file so it works from any cwd.
import { chmod } from "node:fs/promises"
import { join } from "node:path"

const root = import.meta.dir
const outdir = join(root, "dist")

async function build(entry: string, banner?: string) {
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
}

await build("src/hook.ts", "#!/usr/bin/env bun")
await build("src/install.ts", "#!/usr/bin/env bun")
await chmod(join(outdir, "hook.js"), 0o755)
await chmod(join(outdir, "install.js"), 0o755)
console.log("built dist/hook.js and dist/install.js")
