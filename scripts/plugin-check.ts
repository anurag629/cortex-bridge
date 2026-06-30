// Validates the BUILT plugin bundle the way OpenCode loads it: import the
// default export, run server() with a mock PluginInput, and assert the hooks
// and tools are wired. Also exercises the recall tool against the live server.
//
//   bun run scripts/plugin-check.ts
// @ts-ignore - deliberately importing the built bundle (no type declarations);
// this script validates the exact artifact OpenCode loads.
import plugin from "../dist/cognee.plugin.js"

let failures = 0
function check(name: string, cond: boolean) {
  console.log(`${cond ? "ok  " : "FAIL"}  ${name}`)
  if (!cond) failures++
}

const mockInput = {
  client: { session: { messages: async () => [] } },
  project: { id: "plugincheck", worktree: process.cwd() },
  directory: process.cwd(),
  worktree: process.cwd(),
}

check("default export is an object", typeof plugin === "object" && plugin !== null)
check("plugin.id === 'cognee'", (plugin as any).id === "cognee")
check("plugin.server is a function", typeof (plugin as any).server === "function")

const hooks = await (plugin as any).server(mockInput, {})

const toolNames = Object.keys(hooks.tool ?? {})
check("registers cognee_recall", toolNames.includes("cognee_recall"))
check("registers cognee_remember", toolNames.includes("cognee_remember"))
check("registers cognee_feedback", toolNames.includes("cognee_feedback"))
check("registers cognee_optimize", toolNames.includes("cognee_optimize"))
check("registers cognee_forget", toolNames.includes("cognee_forget"))

for (const h of [
  "chat.message",
  "tool.execute.after",
  "experimental.session.compacting",
  "event",
  "dispose",
]) {
  check(`hook ${h} present`, typeof hooks[h] === "function")
}

// Live recall through the tool, against whatever dataset is configured.
const ctx = {
  sessionID: "check-session",
  messageID: "check-msg",
  agent: "build",
  directory: process.cwd(),
  worktree: process.cwd(),
  abort: new AbortController().signal,
  metadata() {},
  ask: async () => {},
}
const out = await hooks.tool.cognee_recall.execute({ query: "auth" }, ctx)
console.log("\ncognee_recall ->", typeof out === "string" ? out : JSON.stringify(out).slice(0, 400))

// Exercise the chat.message injection path with a fake user message.
const parts: any[] = [
  { id: "p1", type: "text", text: "where is auth?", messageID: "check-msg", sessionID: "check-session" },
]
await hooks["chat.message"]({ sessionID: "check-session", messageID: "check-msg" }, { message: {}, parts })
check("chat.message left parts intact or injected", parts.length >= 1)
console.log(`parts after chat.message: ${parts.length} (injected=${parts.length - 1})`)

console.log(`\n${failures === 0 ? "PLUGIN CHECK PASSED" : `PLUGIN CHECK FAILED (${failures})`}`)
process.exit(failures === 0 ? 0 : 1)
