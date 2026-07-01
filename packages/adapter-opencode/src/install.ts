// Installer CLI. Symlinks the built plugin bundle into an OpenCode plugin
// directory so it is auto-discovered with no opencode.json edits.
//
//   opencode-cognee            -> global  (~/.config/opencode/plugin/cognee.js)
//   opencode-cognee --project  -> current repo (./.opencode/plugin/cognee.js)
//   opencode-cognee uninstall  -> remove the link
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
const bundle = resolve(here, "cognee.plugin.js")

const targetDir = project
  ? resolve(process.cwd(), ".opencode", "plugin")
  : join(homedir(), ".config", "opencode", "plugin")
const target = join(targetDir, "cognee.js")

function removeExisting(): void {
  try {
    rmSync(target, { force: true })
  } catch {
    /* ignore */
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

console.log(`Linked Cognee memory plugin -> ${target}`)
console.log(`  source: ${bundle}${useCopy ? " (copied)" : " (symlink, picks up rebuilds)"}`)
console.log(`  scope:  ${project ? "this project (.opencode/plugin)" : "global (~/.config/opencode/plugin)"}`)
console.log("")
console.log("Restart opencode to load it. Configure with COGNEE_* env vars (see README / .env.example).")
