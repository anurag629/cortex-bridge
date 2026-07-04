// The shared hook runtime. Claude Code, Codex, and Kimi Code CLI all run
// external commands on the same lifecycle events and speak the same contract:
// they pass the event JSON on stdin and read a { hookSpecificOutput:
// { additionalContext } } object back on stdout to inject context. So one hook
// binary drives all three; only the install target and the agent label differ.
//
// Each adapter ships a two-line entry that calls runHook() with its own default
// agent label, and installs the host to run `bun hook.js <mode>`:
//   recall   (UserPromptSubmit) -> inject shared memory into the prompt
//   capture  (PostToolUse)      -> record the tool call as a trace
//   stop     (Stop)             -> fold the final answer into shared memory
import { CogneeClient } from "./client"
import { resolveConfig } from "./config"
import { qaEntry } from "./capture"
import { formatRecall } from "./format"
import { clip, sharedSessionId } from "./util"
import type { MemoryEntry } from "./types"

const DEBUG = Boolean(process.env.CORTEX_HOOK_DEBUG)

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

function connect(cwd: string) {
  // Hooks stay silent on stdout (except the recall injection), so the logger is
  // a no-op. Config resolves the same way as every other adapter, so the dataset
  // (and therefore the shared session id) matches OpenCode and the rest.
  const cfg = resolveConfig({ directory: cwd, worktree: cwd })
  return { cfg, client: new CogneeClient(cfg, () => {}) }
}

// UserPromptSubmit: recall from the shared session cache and inject it. This is
// the reliable cross-agent path, so a decision captured by any other agent shows
// up here with no graph build.
async function recall(p: any): Promise<void> {
  const prompt = String(p.prompt ?? "").trim()
  if (!prompt) return
  const { cfg, client } = connect(String(p.cwd ?? process.cwd()))
  const items = await client.recall({
    query: prompt,
    session_id: sharedSessionId(cfg.dataset),
    scope: "session",
    top_k: Math.max(cfg.topK, 8),
    only_context: true,
  })
  const mem = formatRecall(items)
  if (DEBUG) console.error(`[hook] recalled ${items.length} item(s); context ${mem.length} chars`)
  if (!mem) return
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: `# Shared memory (Cortex Bridge)\nContext recalled from this project's cross-agent memory:\n\n${mem}`,
        systemMessage: `Cortex Bridge: recalled ${items.length} item(s) from shared memory`,
      },
    }),
  )
}

// PostToolUse: capture the tool call as a trace in the shared session cache.
async function capture(p: any): Promise<void> {
  const { cfg, client } = connect(String(p.cwd ?? process.cwd()))
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
  await client.rememberEntry(entry, sharedSessionId(cfg.dataset))
}

// Stop: fold the final answer into shared memory so the other agents can recall
// what this one just did. Reliable path first (session cache), then best effort
// into the graph as a durable handoff.
async function stop(p: any, agent: string): Promise<void> {
  const answer = String(p.assistant_message ?? p.message ?? p.last_message ?? "").trim()
  if (!answer) return
  const { cfg, client } = connect(String(p.cwd ?? process.cwd()))
  const sid = sharedSessionId(cfg.dataset)
  await client.rememberEntry(qaEntry(`${agent} session summary`, clip(answer, 1500), agent), sid)
  try {
    await client.ingestToGraph(
      [`# Handoff from ${agent}`, `Project: ${cfg.dataset}`, "", clip(answer, 1500)].join("\n"),
      {
        nodeSet: [`agent:${agent}`, `repo:${cfg.dataset}`, "handoff"],
        filename: `handoff-${agent}-${Date.now()}.md`,
      },
    )
  } catch (e) {
    if (DEBUG) console.error("[hook] graph handoff failed (session cache still has it):", e)
  }
}

// Entry shared by the Claude Code, Codex, and Kimi adapters. The mode comes from
// argv[2]; the agent label defaults per adapter but can be overridden with
// CORTEX_AGENT so one built binary can serve any host.
export async function runHook(defaultAgent = "claude-code"): Promise<void> {
  const agent = process.env.CORTEX_AGENT || defaultAgent
  const mode = process.argv[2] ?? ""
  const payload = await readStdin()
  if (DEBUG)
    console.error(
      `[hook] agent=${agent} mode=${mode} prompt=${JSON.stringify(payload?.prompt)} dataset=${process.env.CORTEX_DATASET} base=${process.env.CORTEX_BASE_URL}`,
    )
  try {
    if (mode === "recall") await recall(payload)
    else if (mode === "capture") await capture(payload)
    else if (mode === "stop") await stop(payload, agent)
  } catch (e) {
    // A hook must never break the host. Fail silent unless debugging.
    if (DEBUG) console.error("[hook] error:", e)
  }
}
