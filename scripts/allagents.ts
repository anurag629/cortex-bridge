// The full headline: one shared memory across OpenCode, Claude Code, Codex, and
// Kimi. Each agent records a decision into the shared session cache (derived from
// the pinned dataset), then a DIFFERENT agent recalls it. The three CLI agents
// are exercised through their REAL built hook binaries, exactly as their host
// runs them on UserPromptSubmit. OpenCode uses the core client directly, the way
// its plugin does. If every leg passes, memory written by any agent surfaces in
// the others.
//
//   CORTEX_MODE=local CORTEX_BASE_URL=http://localhost:8000 bun run allagents
import { CogneeClient, qaEntry, resolveConfig, sharedSessionId } from "@cortex-bridge/core"

const stamp = Date.now()
const dataset = `allagents-${stamp}`
// Env beats the config file, so the in-process client and every spawned hook
// resolve the same dataset (and therefore the same shared session id).
process.env.CORTEX_DATASET = dataset
const cfg = resolveConfig(undefined, { dataset })
const client = new CogneeClient(cfg, () => {})
const shared = sharedSessionId(cfg.dataset)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

if (!(await client.health())) {
  console.error(`[allagents] Cognee not reachable at ${cfg.baseUrl}`)
  process.exit(1)
}
console.log(`[allagents] dataset "${dataset}", shared session "${shared}"`)

// A decision each agent commits to shared memory, with a unique marker so we can
// prove exactly whose write was recalled.
const decisions = {
  opencode: {
    marker: `OC-${stamp}`,
    q: "Which JWT library did we pick and why?",
    a: `We chose jose over jsonwebtoken because the project is ESM. [${`OC-${stamp}`}]`,
  },
  "claude-code": {
    marker: `CC-${stamp}`,
    q: "Which Postgres host did we settle on?",
    a: `We went with the Neon pooler; it drops idle connections at about 30s. [${`CC-${stamp}`}]`,
  },
  codex: {
    marker: `CX-${stamp}`,
    q: "Which test runner did we standardize on?",
    a: `We standardized on the Bun test runner over vitest for speed. [${`CX-${stamp}`}]`,
  },
  kimi: {
    marker: `KM-${stamp}`,
    q: "How do we manage server state on the frontend?",
    a: `We use TanStack Query for server state, not Redux. [${`KM-${stamp}`}]`,
  },
}

// Every agent writes into the SAME shared session cache. Each adapter does this
// through the same core call, so writing them here is faithful to all four.
for (const [agent, d] of Object.entries(decisions)) {
  await client.rememberEntry(qaEntry(d.q, d.a, agent), shared)
  console.log(`[allagents] ${agent} recorded a decision (${d.marker})`)
}

// Recall a decision made by ANOTHER agent, through the recaller's real hook
// binary (or the core client for OpenCode). marker is what must surface.
async function recallVia(
  recaller: string,
  query: string,
  marker: string,
): Promise<boolean> {
  const hookPath =
    recaller === "opencode"
      ? null
      : new URL(`../packages/adapter-${recaller}/dist/hook.js`, import.meta.url).pathname
  for (let i = 0; i < 6; i++) {
    if (hookPath) {
      const proc = Bun.spawn(["bun", hookPath, "recall"], {
        stdin: new TextEncoder().encode(
          JSON.stringify({ prompt: query, cwd: process.cwd(), session_id: `${recaller}-test` }),
        ),
        stdout: "pipe",
        env: { ...process.env, CORTEX_DATASET: dataset, CORTEX_BASE_URL: cfg.baseUrl, CORTEX_MODE: "local" },
      })
      const out = await new Response(proc.stdout).text()
      if (out.includes(marker)) return true
    } else {
      const items = await client.recall({
        query,
        session_id: shared,
        scope: "session",
        top_k: 8,
        only_context: true,
      })
      if (JSON.stringify(items).includes(marker)) return true
    }
    await sleep(2000)
  }
  return false
}

// The matrix: each agent recalls a decision a different agent made. Between them
// the four legs cover every writer and every reader.
const legs = [
  { reader: "claude-code", wrote: "opencode" },
  { reader: "codex", wrote: "claude-code" },
  { reader: "kimi", wrote: "codex" },
  { reader: "opencode", wrote: "kimi" },
] as const

let allPass = true
console.log("")
for (const leg of legs) {
  const d = decisions[leg.wrote]
  const ok = await recallVia(leg.reader, d.q, d.marker)
  allPass &&= ok
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${leg.reader.padEnd(12)} recalled ${leg.wrote}'s decision (${d.marker})`,
  )
}

console.log("")
if (allPass) {
  console.log("ALL-AGENTS PASS: OpenCode, Claude Code, Codex, and Kimi share one memory.")
  console.log(`  one dataset ("${dataset}"), four agents, every write crossed over.`)
  process.exit(0)
}
console.log("ALL-AGENTS FAIL: at least one agent did not recall another's write.")
console.log("  Check the server is up and the session cache (CACHING=true) is enabled.")
process.exit(1)
