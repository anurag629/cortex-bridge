// Installer: wires the Cortex Bridge hooks into Claude Code's settings so it
// shares memory with your other agents. Adds three hooks that call the bundled
// entry. Idempotent: it strips any prior Cortex Bridge hooks before adding, so
// re-running never duplicates, and `uninstall` cleanly removes them.
//
//   cortex-bridge-claude-code            -> global  (~/.claude/settings.json)
//   cortex-bridge-claude-code --project  -> current repo (./.claude/settings.json)
//   cortex-bridge-claude-code uninstall  -> remove our hooks
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const argv = process.argv.slice(2)
const flags = new Set(argv)
const project = flags.has("--project") || flags.has("-p")
const uninstall = argv.includes("uninstall") || flags.has("--uninstall")

const here = dirname(fileURLToPath(import.meta.url))
const hookJs = resolve(here, "hook.js")

const settingsPath = project
  ? resolve(process.cwd(), ".claude", "settings.json")
  : join(homedir(), ".claude", "settings.json")

// The three hooks we add. Matcher on PostToolUse limits capture to real actions.
const OURS: Record<string, { matcher?: string; entry: any }> = {
  UserPromptSubmit: {
    entry: { type: "command", command: `bun "${hookJs}" recall`, timeout: 15 },
  },
  PostToolUse: {
    matcher: "Bash|Read|Write|Edit|MultiEdit|Grep|Glob|Task",
    entry: { type: "command", command: `bun "${hookJs}" capture`, timeout: 10, async: true },
  },
  Stop: {
    entry: { type: "command", command: `bun "${hookJs}" stop`, timeout: 20, async: true },
  },
}

function isOurs(command: unknown): boolean {
  return typeof command === "string" && command.includes(hookJs)
}

function loadSettings(): any {
  try {
    if (existsSync(settingsPath)) return JSON.parse(readFileSync(settingsPath, "utf8"))
  } catch {
    // fall through to a fresh object
  }
  return {}
}

function writeSettings(s: any): void {
  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(s, null, 2))
}

const settings = loadSettings()
settings.hooks = settings.hooks ?? {}

// Strip any prior Cortex Bridge hooks (idempotency + uninstall).
for (const event of Object.keys(settings.hooks)) {
  const groups = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : []
  for (const g of groups) {
    if (Array.isArray(g.hooks)) g.hooks = g.hooks.filter((h: any) => !isOurs(h?.command))
  }
  settings.hooks[event] = groups.filter((g: any) => Array.isArray(g.hooks) && g.hooks.length > 0)
  if (settings.hooks[event].length === 0) delete settings.hooks[event]
}

if (uninstall) {
  writeSettings(settings)
  console.log(`Removed Cortex Bridge hooks from ${settingsPath}`)
  process.exit(0)
}

// Add ours.
for (const [event, spec] of Object.entries(OURS)) {
  const group: any = { hooks: [spec.entry] }
  if (spec.matcher) group.matcher = spec.matcher
  settings.hooks[event] = settings.hooks[event] ?? []
  settings.hooks[event].push(group)
}

writeSettings(settings)
console.log(`Wired Cortex Bridge (Claude Code adapter) into ${settingsPath}`)
console.log(`  hook entry: ${hookJs}`)
console.log("  events: UserPromptSubmit (recall), PostToolUse (capture), Stop (handoff)")
console.log("")
console.log("Restart Claude Code. Configure with CORTEX_* env vars or ~/.config/cortex-bridge/config.json.")
console.log("For cross-agent sharing, pin the SAME CORTEX_DATASET as your other agents.")
