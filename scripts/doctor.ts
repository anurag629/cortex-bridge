// Cross-agent canary. Proves the premise of Cortex Bridge: a write by one agent
// is recalled by a different agent, on the same pinned dataset, through the
// shared session cache. Run it before any cross-agent demo.
//
//   CORTEX_MODE=local CORTEX_BASE_URL=http://localhost:8000 bun run doctor
//
// Two agents = two clients sharing one session id (derived from the dataset).
// Agent A captures a decision; agent B recalls it.
import { CogneeClient, qaEntry, resolveConfig, sharedSessionId } from "@cortex-bridge/core"

const dataset = process.env.CORTEX_DATASET ?? "cortex-doctor"
process.env.CORTEX_DATASET = dataset
const cfg = resolveConfig(undefined, { dataset })
const log = (m: string, ...a: any[]) => console.log(`[doctor] ${m}`, ...a)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const shared = sharedSessionId(cfg.dataset)
const marker = `ZORP-${Date.now()}`
const agentA = new CogneeClient(cfg, log)
const agentB = new CogneeClient(cfg, log)

if (!(await agentA.health())) {
  console.error(`[doctor] Cognee not reachable at ${cfg.baseUrl}`)
  process.exit(1)
}
log(`server ${(await agentA.health())?.version ?? "?"} healthy; shared session "${shared}"`)

// 1) Agent A captures a decision into the shared session cache.
await agentA.rememberEntry(
  qaEntry("Which JWT library and why?", `chose jose over jsonwebtoken because ESM. ${marker}`, "auth"),
  shared,
)
log("agent A captured a decision")

// 2) Agent B, a different client, recalls it from the same shared session.
let found = false
let lastCount = 0
for (let attempt = 1; attempt <= 5 && !found; attempt++) {
  const items = await agentB.recall({
    query: "jwt library jose decision",
    session_id: shared,
    scope: "session",
    top_k: 8,
    only_context: true,
  })
  lastCount = items.length
  if (JSON.stringify(items).includes(marker)) {
    found = true
    break
  }
  await sleep(2000)
}

if (found) {
  console.log("\nDOCTOR PASS: agent B recalled agent A's write on the shared session.")
  console.log(`  one dataset ("${cfg.dataset}"), two agents, memory crossed over.`)
  process.exit(0)
}
console.log(`\nDOCTOR FAIL: agent B did not recall A's marker (last recall returned ${lastCount} item(s)).`)
console.log("  Check the server is up and CACHING=true (the session cache must be enabled).")
process.exit(1)
