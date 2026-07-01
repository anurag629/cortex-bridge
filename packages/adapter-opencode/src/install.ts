// Installer CLI. Symlinks the built plugin bundle into an OpenCode plugin
// directory so it is auto-discovered with no opencode.json edits.
//
//   cortex-bridge-opencode            -> global  (~/.config/opencode/plugin/cortex-bridge.js)
//   cortex-bridge-opencode --project  -> current repo (./.opencode/plugin/cortex-bridge.js)
//   cortex-bridge-opencode uninstall  -> remove the link
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const argv = process.argv.slice(2)
const flags = new Set(argv)
const project = flags.has("--project") || flags.has("-p")
const uninstall = argv.includes("uninstall") || flags.has("--uninstall")
const useCopy = flags.has("--copy")

const here = dirname(fileURLToPath(import.meta.url))
const bundle = resolve(here, "cortex-bridge.plugin.js")

const targetDir = project
  ? resolve(process.cwd(), ".opencode", "plugin")
  : join(homedir(), ".config", "opencode", "plugin")
const target = join(targetDir, "cortex-bridge.js")
// Also clean up the pre-rename link name if it is still around.
const legacyTarget = join(targetDir, "cognee.js")

function removeExisting(): void {
  for (const t of [target, legacyTarget]) {
    try {
      rmSync(t, { force: true })
    } catch {
      /* ignore */
    }
  }
}

if (uninstall) {
  removeExisting()
  console.log(`Removed ${target}`)
  process.exit(0)
}

if (!existsSync(bundle)) {
  console.error(`Plugin bundle not found at ${bundle}.`)
  console.error("Run `bun run build` first.")
  process.exit(1)
}

mkdirSync(targetDir, { recursive: true })
removeExisting()

if (useCopy) {
  copyFileSync(bundle, target)
  chmodSync(target, 0o644)
} else {
  symlinkSync(bundle, target)
}

console.log(`Linked Cortex Bridge (OpenCode adapter) -> ${target}`)
console.log(`  source: ${bundle}${useCopy ? " (copied)" : " (symlink, picks up rebuilds)"}`)
console.log(`  scope:  ${project ? "this project (.opencode/plugin)" : "global (~/.config/opencode/plugin)"}`)
console.log("")
console.log("Restart opencode to load it. Configure with CORTEX_* (or legacy COGNEE_*) env vars or a config file (see README / .env.example).")
