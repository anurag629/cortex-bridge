// Installer: wires the Cortex Bridge hooks into Codex CLI so it shares memory
// with your other agents. Codex reads global hooks from ~/.codex/hooks.json and
// speaks the same contract as Claude Code, so this adds three hooks that call the
// bundled entry. Idempotent: it strips any prior Cortex Bridge hooks before
// adding, so re-running never duplicates, and `uninstall` removes them cleanly.
//
//   cortex-bridge-codex            -> global (~/.codex/hooks.json)
//   cortex-bridge-codex uninstall  -> remove our hooks
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const argv = process.argv.slice(2)
const flags = new Set(argv)
const uninstall = argv.includes("uninstall") || flags.has("--uninstall")

const here = dirname(fileURLToPath(import.meta.url))
const hookJs = resolve(here, "hook.js")

const hooksPath = join(homedir(), ".codex", "hooks.json")

// Codex timeouts are in seconds. UserPromptSubmit is on the answer path so keep
// it tight; capture and stop are async so they never block a turn.
const OURS: Record<string, { matcher?: string; entry: any }> = {
  UserPromptSubmit: {
    entry: { type: "command", command: `bun "${hookJs}" recall`, timeout: 15 },
  },
  PostToolUse: {
    matcher: "*",
    entry: { type: "command", command: `bun "${hookJs}" capture`, timeout: 10 },
  },
  Stop: {
    entry: { type: "command", command: `bun "${hookJs}" stop`, timeout: 20 },
  },
}

function isOurs(command: unknown): boolean {
  return typeof command === "string" && command.includes(hookJs)
}

function load(): any {
  try {
    if (existsSync(hooksPath)) return JSON.parse(readFileSync(hooksPath, "utf8"))
  } catch {
    // fall through to a fresh object
  }
  return {}
}

function write(cfg: any): void {
  mkdirSync(dirname(hooksPath), { recursive: true })
  writeFileSync(hooksPath, JSON.stringify(cfg, null, 2))
}

const cfg = load()
cfg.hooks = cfg.hooks ?? {}

// Strip any prior Cortex Bridge hooks (idempotency + uninstall).
for (const event of Object.keys(cfg.hooks)) {
  const groups = Array.isArray(cfg.hooks[event]) ? cfg.hooks[event] : []
  for (const g of groups) {
    if (Array.isArray(g.hooks)) g.hooks = g.hooks.filter((h: any) => !isOurs(h?.command))
  }
  cfg.hooks[event] = groups.filter((g: any) => Array.isArray(g.hooks) && g.hooks.length > 0)
  if (cfg.hooks[event].length === 0) delete cfg.hooks[event]
}

if (uninstall) {
  write(cfg)
  console.log(`Removed Cortex Bridge hooks from ${hooksPath}`)
  process.exit(0)
}

for (const [event, spec] of Object.entries(OURS)) {
  const group: any = { hooks: [spec.entry] }
  if (spec.matcher) group.matcher = spec.matcher
  cfg.hooks[event] = cfg.hooks[event] ?? []
  cfg.hooks[event].push(group)
}

write(cfg)
console.log(`Wired Cortex Bridge (Codex adapter) into ${hooksPath}`)
console.log(`  hook entry: ${hookJs}`)
console.log("  events: UserPromptSubmit (recall), PostToolUse (capture), Stop (handoff)")
console.log("")
console.log("Codex skips new hooks until you trust them. Run /hooks inside Codex to review and")
console.log("trust them, or start Codex once with --dangerously-bypass-hook-trust.")
console.log("For cross-agent sharing, pin the SAME CORTEX_DATASET as your other agents.")
