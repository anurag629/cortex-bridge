// Day-1 end-to-end smoke test against a running Cognee server.
// Proves the full capture -> recall -> bridge loop the plugin relies on.
//
//   bun run scripts/smoke.ts
//
// Honors the same COGNEE_* env vars as the plugin. Uses a dedicated dataset and
// a fresh session id so it never pollutes real project memory.
import { resolveConfig } from "../src/config"
import { CogneeClient } from "../src/client"

const cfg = resolveConfig(undefined, { dataset: process.env.COGNEE_DATASET ?? "oc-mem-smoke" })
const log = (m: string, ...a: any[]) => console.log(`[smoke] ${m}`, ...a)
const client = new CogneeClient(cfg, log)
const sid = `oc-smoke-${Date.now()}`

async function time<T>(label: string, p: Promise<T>): Promise<T> {
  const t = Date.now()
  const r = await p
  console.log(`  ${label}: ${Date.now() - t}ms`)
  return r
}

console.log(`Cognee: ${cfg.baseUrl} (mode=${cfg.mode}, dataset=${cfg.dataset})`)

const health = await time("health", client.health())
console.log("  health =", health)
if (!health) {
  console.error("Cognee not reachable. Start it and/or set COGNEE_BASE_URL.")
  process.exit(1)
}

await client.ensureAuth()

const t1 = await time(
  "remember/entry (trace)",
  client.rememberEntry(
    {
      type: "trace",
      origin_function: "edit",
      status: "success",
      method_params: { path: "src/auth/jwt.ts" },
      method_return_value: "added verifyToken() using fastapi-users",
    },
    sid,
  ),
)
console.log("  ->", t1)

const t2 = await time(
  "remember/entry (qa)",
  client.rememberEntry(
    {
      type: "qa",
      question: "Where does auth live in this project?",
      answer: "In src/auth/jwt.ts, built on fastapi-users.",
      context: "smoke test",
    },
    sid,
  ),
)
console.log("  ->", t2)

const rec = await time("recall (session)", client.recall({ query: "auth", session_id: sid, only_context: true }))
console.log(`  recalled ${rec.length} item(s)`)
console.dir(rec, { depth: 3 })

await time("improve (bridge to graph)", client.improve([sid]))

console.log("")
console.log("visualize:", client.visualizeUrl())
console.log(`SMOKE OK  dataset=${cfg.dataset}  session=${sid}`)
console.log("(the recall above should contain the trace and/or QA we just wrote)")
