// Cross-agent canary. Proves the whole premise of Cortex Bridge: a write by one
// agent is recalled by a DIFFERENT agent, on the same pinned dataset, through
// the shared Cognee graph. Run it before any cross-agent demo.
//
//   CORTEX_MODE=local CORTEX_BASE_URL=http://localhost:8000 bun run doctor
//
// It simulates two agents as two clients with different sessions but the SAME
// explicitly-pinned dataset. Agent A writes a handoff straight into the graph
// (add + cognify, the durable cross-agent path); agent B recalls it.
import { resolveConfig, CogneeClient } from "@cortex-bridge/core"

const dataset = process.env.CORTEX_DATASET ?? process.env.COGNEE_DATASET ?? "cortex-doctor"
const cfg = resolveConfig(undefined, { dataset })
const log = (m: string, ...a: any[]) => console.log(`[doctor] ${m}`, ...a)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const stamp = Date.now()

const agentA = new CogneeClient(cfg, log)
const agentB = new CogneeClient(cfg, log)
const sessionB = `agentB-${stamp}`

// A distinctive marker only agent A writes. Agent B must surface it.
const marker = `ZORP-${stamp}`
const handoff = [
  "# Handoff (from agent A)",
  "Decision: the auth module uses jose (not jsonwebtoken) because the project is ESM.",
  `marker: ${marker}`,
  "Next step: wire the /refresh endpoint. Do not touch auth.ts.",
].join("\n")

const health = await agentA.health()
if (!health) {
  console.error(`[doctor] Cognee not reachable at ${cfg.baseUrl}`)
  process.exit(1)
}
log(`server ${health.version ?? "?"} healthy; dataset="${cfg.dataset}" pinned for both agents`)

// 1. Agent A writes a handoff straight into the shared graph, tagged with provenance.
log("agent A is ingesting a handoff into the shared graph (add + cognify)...")
await agentA.ingestToGraph(handoff, {
  nodeSet: ["agent:agentA", "repo:doctor", "handoff"],
  filename: `handoff-${stamp}.md`,
  wait: true,
})
log("agent A's handoff is in the graph")

// 2. Agent B, a different session, recalls from the same dataset. Poll briefly
//    for eventual consistency of the vector index after cognify.
let found = false
let lastCount = 0
for (let attempt = 1; attempt <= 10 && !found; attempt++) {
  const items = await agentB.recall({
    query: `auth jwt library decision ${marker}`,
    session_id: sessionB,
    scope: "graph",
    search_type: "CHUNKS",
    top_k: 10,
    only_context: true,
  })
  lastCount = items.length
  if (JSON.stringify(items).includes(marker)) {
    found = true
    break
  }
  await sleep(3000)
}

if (found) {
  console.log(`\nDOCTOR PASS: agent B (session ${sessionB}) recalled agent A's handoff via the shared graph.`)
  console.log(`  one dataset ("${cfg.dataset}"), two agents, memory crossed over.`)
  process.exit(0)
}
console.log(`\nDOCTOR FAIL: agent B did not recall A's marker (last recall returned ${lastCount} item(s)).`)
console.log("  The graph build (cognify) needs a reachable LLM: self-hosted needs a local model, cloud needs the tenant LLM.")
process.exit(1)
