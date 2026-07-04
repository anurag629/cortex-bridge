// Cortex Bridge, Claude Code adapter. One entry, dispatched by the hook name in
// argv[2]. Claude Code runs `bun hook.js <mode>` on each hook and passes the
// event JSON on stdin. It reuses @cortex-bridge/core, so a decision captured in
// any agent is recallable here, and Claude's own work flows back to the others.
//
// Modes:
//   recall   (UserPromptSubmit) -> inject shared memory into Claude's context
//   capture  (PostToolUse)      -> record the tool call as a trace
//   stop     (Stop)             -> write a handoff into the shared graph
import { CogneeClient, clip, formatRecall, resolveConfig, type MemoryEntry } from "@cortex-bridge/core"

const AGENT = "claude-code"

async function readStdin(): Promise<any> {
  try {
    const chunks: Buffer[] = []
    for await (const c of process.stdin) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks).toString("utf8").trim()
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

// Claude Code passes its host session id under one of several names. We turn it
// into a stable Cortex Bridge session id so recall works across a conversation.
function sessionKey(p: any): string {
  const id =
    p.session_id ?? p.sessionId ?? p.conversation_id ?? p.transcript?.session_id ?? "adhoc"
  return `claude-${String(id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)}`
}

function connect(cwd: string) {
  // Hooks must stay silent on stdout (except the recall injection), so the
  // logger is a no-op.
  const cfg = resolveConfig({ directory: cwd, worktree: cwd })
  return { cfg, client: new CogneeClient(cfg, () => {}) }
}

// UserPromptSubmit: recall shared memory and inject it into Claude's context.
async function recall(p: any): Promise<void> {
  const prompt = String(p.prompt ?? "").trim()
  if (!prompt) return
  const cwd = String(p.cwd ?? process.cwd())
  const { cfg, client } = connect(cwd)
  const items = await client.recall({
    query: prompt,
    session_id: sessionKey(p),
    scope: "graph",
    search_type: "CHUNKS", // raw source text is fast and fits a 15s hook budget
    top_k: Math.max(cfg.topK, 8),
    only_context: true,
  })
  const mem = formatRecall(items)
  if (!mem) return
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: `# Shared memory (Cortex Bridge)\nContext recalled from this project's cross-agent memory graph:\n\n${mem}`,
        systemMessage: `Cortex Bridge: recalled ${items.length} item(s) from shared memory`,
      },
    }),
  )
}

// PostToolUse: capture the tool call as a trace in the session cache.
async function capture(p: any): Promise<void> {
  const { client } = connect(String(p.cwd ?? process.cwd()))
  const out = p.tool_output ?? p.tool_response ?? ""
  const isErr = Boolean(p.error) || Boolean(out && typeof out === "object" && out.is_error)
  const entry: MemoryEntry = {
    type: "trace",
    origin_function: String(p.tool_name ?? "unknown"),
    status: isErr ? "error" : "success",
    method_params: (p.tool_input ?? {}) as Record<string, any>,
    method_return_value: clip(typeof out === "string" ? out : JSON.stringify(out ?? ""), 4000),
    error_message: String(p.error ?? ""),
  }
  await client.rememberEntry(entry, sessionKey(p))
}

// Stop: write a handoff of what Claude just did straight into the shared graph,
// so OpenCode (or any agent) can recall it. This makes Claude a full peer.
async function stop(p: any): Promise<void> {
  const answer = String(p.assistant_message ?? p.message ?? "").trim()
  if (!answer) return
  const { cfg, client } = connect(String(p.cwd ?? process.cwd()))
  const body = [
    `# Handoff from ${AGENT}`,
    `Project: ${cfg.dataset}`,
    "",
    "## What Claude Code just did",
    clip(answer, 1500),
  ].join("\n")
  await client.ingestToGraph(body, {
    nodeSet: [`agent:${AGENT}`, `repo:${cfg.dataset}`, "handoff"],
    filename: `handoff-claude-${sessionKey(p)}.md`,
  })
}

const mode = process.argv[2] ?? ""
const payload = await readStdin()
try {
  if (mode === "recall") await recall(payload)
  else if (mode === "capture") await capture(payload)
  else if (mode === "stop") await stop(payload)
} catch {
  // A hook must never break the host. Fail silent.
}
process.exit(0)
