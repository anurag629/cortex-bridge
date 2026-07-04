// Installer: wires the Cortex Bridge hooks into Kimi Code CLI so it shares memory
// with your other agents. Kimi reads hooks from the [[hooks]] array in
// ~/.kimi/config.toml. This appends three hooks that call the bundled entry,
// wrapped in sentinel comments so it stays idempotent: re-running strips the
// managed block first, and `uninstall` removes it without touching the rest of
// your config.
//
//   cortex-bridge-kimi            -> ~/.kimi/config.toml
//   cortex-bridge-kimi uninstall  -> remove our hooks
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const argv = process.argv.slice(2)
const flags = new Set(argv)
const uninstall = argv.includes("uninstall") || flags.has("--uninstall")

const here = dirname(fileURLToPath(import.meta.url))
const hookJs = resolve(here, "hook.js")

const configPath = join(homedir(), ".kimi", "config.toml")

const BEGIN = "# >>> cortex-bridge (managed) — do not edit this block >>>"
const END = "# <<< cortex-bridge (managed) <<<"

// Kimi timeouts are in seconds. Single-quoted TOML literals keep the double
// quotes around the path intact without escaping.
function hookBlock(): string {
  const line = (event: string, mode: string, timeout: number) =>
    ["[[hooks]]", `event = "${event}"`, `command = 'bun "${hookJs}" ${mode}'`, `timeout = ${timeout}`].join("\n")
  return [
    BEGIN,
    "# Shared cross-agent memory backed by Cognee. Managed by cortex-bridge-kimi.",
    line("UserPromptSubmit", "recall", 15),
    "",
    line("PostToolUse", "capture", 10),
    "",
    line("Stop", "stop", 20),
    END,
  ].join("\n")
}

// Drop any previously managed block (between the sentinels, inclusive) so we
// never duplicate and uninstall is clean. Leaves everything else untouched.
function stripManaged(text: string): string {
  const start = text.indexOf(BEGIN)
  if (start === -1) return text
  const end = text.indexOf(END, start)
  if (end === -1) return text.slice(0, start).replace(/\n+$/, "\n")
  const after = text.slice(end + END.length)
  return (text.slice(0, start) + after.replace(/^\n+/, "\n")).replace(/\n{3,}/g, "\n\n")
}

let existing = ""
try {
  if (existsSync(configPath)) existing = readFileSync(configPath, "utf8")
} catch {
  existing = ""
}

let next = stripManaged(existing).replace(/\s*$/, "")

if (uninstall) {
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, next ? next + "\n" : "")
  console.log(`Removed Cortex Bridge hooks from ${configPath}`)
  process.exit(0)
}

next = (next ? next + "\n\n" : "") + hookBlock() + "\n"
mkdirSync(dirname(configPath), { recursive: true })
writeFileSync(configPath, next)

console.log(`Wired Cortex Bridge (Kimi adapter) into ${configPath}`)
console.log(`  hook entry: ${hookJs}`)
console.log("  events: UserPromptSubmit (recall), PostToolUse (capture), Stop (handoff)")
console.log("")
console.log("Restart Kimi. For cross-agent sharing, pin the SAME CORTEX_DATASET as your other agents.")
