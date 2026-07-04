// The headline, verified end to end: a decision captured by OpenCode, recalled
// through the REAL Claude Code adapter hook. Both agents share one session id
// (derived from the pinned dataset), so it flows through the session cache with
// no graph build. Proves memory written by one agent surfaces in another.
//
//   CORTEX_MODE=local CORTEX_BASE_URL=http://localhost:8000 bun run scripts/crossagent.ts
import { CogneeClient, qaEntry, resolveConfig, sharedSessionId } from "@cortex-bridge/core"

const marker = `MARK${Date.now()}`
const dataset = `team-cortex-${Date.now()}`
// Ensure the in-process client and the spawned hook agree on the dataset. Env
// beats the config file, which the options arg does not.
process.env.CORTEX_DATASET = dataset
const cfg = resolveConfig(undefined, { dataset })
const client = new CogneeClient(cfg, (m: string) => console.log("  [core]", m))
const shared = sharedSessionId(cfg.dataset)

if (!(await client.health())) {
  console.error(`[crossagent] Cognee not reachable at ${cfg.baseUrl}`)
  process.exit(1)
}
console.log(`[crossagent] shared session "${shared}" (both agents), dataset "${dataset}"`)

// 1) OpenCode captures a decision into the shared session cache (as its adapter does).
console.log(`[crossagent] OpenCode capturing a decision (marker=${marker})...`)
await client.rememberEntry(
  qaEntry(
    "Which JWT library and why?",
    `We chose jose over jsonwebtoken because the project is ESM. ${marker}`,
    "auth refactor",
  ),
  shared,
)
console.log("[crossagent] captured to the shared session cache; recalling AS Claude Code (real hook)")

// 2) The real Claude Code recall hook reads it from the same shared session.
const hookPath = new URL("../packages/adapter-claude-code/dist/hook.js", import.meta.url).pathname
const payload = JSON.stringify({
  prompt: "what did we decide about the JWT library in auth?",
  session_id: "cc-test",
  cwd: process.cwd(),
})

let found = false
let out = ""
for (let i = 0; i < 6 && !found; i++) {
  const proc = Bun.spawn(["bun", hookPath, "recall"], {
    stdin: new TextEncoder().encode(payload),
    stdout: "pipe",
    env: { ...process.env, CORTEX_DATASET: dataset, CORTEX_BASE_URL: cfg.baseUrl, CORTEX_MODE: "local" },
  })
  out = await new Response(proc.stdout).text()
  if (out.includes(marker)) {
    found = true
    break
  }
  await new Promise((r) => setTimeout(r, 2000))
}

if (found) {
  console.log("\nCROSS-AGENT PASS: the Claude Code hook recalled OpenCode's captured decision.")
  const ctx = String(JSON.parse(out).hookSpecificOutput?.additionalContext ?? "")
  console.log("  injected into Claude's prompt (first 260 chars):")
  console.log("  " + ctx.slice(0, 260).replace(/\n/g, "\n  "))
  process.exit(0)
}
console.log("\nCROSS-AGENT FAIL: the Claude Code hook did not surface the marker.")
console.log("  last hook stdout:", out.slice(0, 300) || "(empty)")
process.exit(1)
