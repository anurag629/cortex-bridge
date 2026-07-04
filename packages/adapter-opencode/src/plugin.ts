import {
  CogneeClient,
  clip,
  formatRecall,
  qaEntry,
  resolveConfig,
  SessionBuffer,
  Status,
  traceFromTool,
  uid,
} from "@cortex-bridge/core"
import { extractAssistantText, extractUserText } from "./transcript"
import type { Hooks, PluginInput, PluginModule, ToolDefinition } from "./types"

const server = async (input: PluginInput, options?: Record<string, any>): Promise<Hooks> => {
  const cfg = resolveConfig(
    { projectId: input.project?.id, worktree: input.worktree, directory: input.directory },
    options,
  )
  const log = (msg: string, ...a: any[]) => {
    if (cfg.debug) console.error(`[cortex] ${msg}`, ...a)
  }
  const client = new CogneeClient(cfg, log)
  const buffer = new SessionBuffer(client, cfg.bridgeDebounceMs, log)

  const health = await client.health()
  if (!health) {
    console.error(
      `[cortex] Cognee server not reachable at ${cfg.baseUrl}. Memory features are disabled until it is up.`,
    )
  } else {
    log(`connected to Cognee ${health.version ?? "?"} (mode=${cfg.mode}, dataset=${cfg.dataset})`)
  }
  await client.ensureAuth()

  // Snapshot file the user can inspect: ~/.config/cortex-bridge/status.json.
  // OpenCode does not surface plugin logs, so this is the verification surface.
  const status = new Status({
    connected: !!health,
    cogneeVersion: health?.version ?? null,
    mode: cfg.mode,
    baseUrl: cfg.baseUrl,
    apiPrefix: cfg.apiPrefix,
    dataset: cfg.dataset,
    auth: cfg.apiKey ? "api-key" : cfg.username ? "login" : "none",
    configSource: cfg.source,
  })

  // --- AI-callable tools (model-driven memory) ---------------------------------

  const cortex_recall: ToolDefinition = {
    description:
      "Search your persistent project memory (decisions, past code changes, prior Q&A, and feedback) for anything relevant. Use it when you might be missing context established earlier or in a previous session.",
    args: {
      query: { type: "string", description: "What to look up in memory" },
    },
    async execute(args, ctx) {
      // Return raw recalled context (fast, no server-side LLM synthesis) and let
      // the model reason over it.
      const items = await client.recall({
        query: String(args?.query ?? ""),
        session_id: buffer.cogneeSessionId(ctx.sessionID),
        top_k: Math.max(cfg.topK, 12),
        only_context: true,
      })
      const text = formatRecall(items)
      return { output: text || "No relevant memory found.", metadata: { count: items.length } }
    },
  }

  const cortex_remember: ToolDefinition = {
    description:
      "Save an important fact, decision, or lesson to persistent memory so it is available in future sessions for this project.",
    args: {
      text: { type: "string", description: "The fact, decision, or lesson to remember" },
    },
    async execute(args, ctx) {
      const sid = buffer.cogneeSessionId(ctx.sessionID)
      await client.rememberEntry(qaEntry("Saved note", String(args?.text ?? ""), "manual note"), sid)
      buffer.markDirty(ctx.sessionID)
      return "Saved to memory."
    },
  }

  const cortex_feedback: ToolDefinition = {
    description:
      "Record feedback on a past answer so future recommendations improve. Use the qa_id from a prior cortex_recall result. Positive scores reinforce that approach; negative scores discourage it.",
    args: {
      qa_id: {
        type: "string",
        description: "The qa_id of the memory to attach feedback to (from a recall result)",
      },
      score: { type: "number", description: "Feedback score from -1 (bad) to 1 (good)" },
      note: { type: "string", description: "Short reason for the feedback" },
    },
    async execute(args, ctx) {
      const sid = buffer.cogneeSessionId(ctx.sessionID)
      await client.rememberEntry(
        {
          type: "feedback",
          qa_id: String(args?.qa_id ?? ""),
          feedback_score: Number(args?.score ?? 0),
          feedback_text: String(args?.note ?? ""),
        },
        sid,
      )
      buffer.markDirty(ctx.sessionID)
      return "Feedback recorded."
    },
  }

  const cortex_optimize: ToolDefinition = {
    description:
      "Optimize this project's memory graph: consolidate related facts, prune stale nodes, and reweight connections from accumulated feedback. Run it after a lot of new activity or several feedback entries.",
    args: {},
    async execute() {
      await client.memify()
      return "Memory optimization started (runs in the background)."
    },
  }

  const cortex_forget: ToolDefinition = {
    description:
      "Delete stored memory for this project. Use only when the user explicitly asks to forget or reset memory. By default clears this project's knowledge graph and cached entries; raw ingested files are kept.",
    args: {
      everything: {
        type: "boolean",
        description:
          "If true, delete ALL of this user's memory across every project, not just this one. Use with extreme care and only on explicit request.",
      },
    },
    async execute(args) {
      const everything = Boolean(args?.everything)
      await client.forget(
        everything ? { everything: true } : { dataset: cfg.dataset, memory_only: true },
      )
      return everything
        ? "Deleted all stored memory."
        : `Cleared memory for ${cfg.dataset}.`
    },
  }

  const cortex_handoff: ToolDefinition = {
    description:
      "Write a handoff of the current session into shared memory so another agent, or a later session in any tool, can pick up where you left off. Call it when you finish a task or before switching tools.",
    args: {
      summary: {
        type: "string",
        description: "Optional extra summary or next-step note to include in the handoff",
      },
    },
    async execute(args, ctx) {
      const extra = String(args?.summary ?? "").trim()
      if (extra) note(ctx.sessionID, `- note: ${extra}`)
      const wrote = await ingestHandoff(ctx.sessionID)
      return wrote ? "Handoff written to shared memory." : "Nothing to hand off yet."
    },
  }

  // --- helpers ----------------------------------------------------------------

  // On idle, pair the user's question with the assistant's reply and store it.
  async function closeQA(sessionID: string): Promise<void> {
    const { question } = buffer.takeOpenQuestion(sessionID)
    if (!question) return
    let answer = ""
    try {
      const res: any = await input.client.session.messages({
        path: { id: sessionID },
        query: { limit: 40 },
      })
      const list: any[] = Array.isArray(res) ? res : (res?.data ?? [])
      answer = extractAssistantText(list)
    } catch (e) {
      log(`session.messages failed: ${String(e)}`)
    }
    if (!answer) return
    await client.rememberEntry(qaEntry(question, answer), buffer.cogneeSessionId(sessionID))
    buffer.markDirty(sessionID)
    note(sessionID, `- Q: ${clip(question, 200)}\n  A: ${clip(answer, 400)}`)
  }

  // Handoffs are the durable cross-agent unit: a compact record of what a
  // session did, written straight into the shared graph (not the session cache,
  // which stays same-session). Any other agent recalls them via the graph.
  const AGENT = "opencode"
  const handoffLines = new Map<string, string[]>()
  function note(sessionID: string, line: string): void {
    const arr = handoffLines.get(sessionID) ?? []
    arr.push(line)
    handoffLines.set(sessionID, arr)
  }
  async function ingestHandoff(sessionID: string): Promise<boolean> {
    const lines = handoffLines.get(sessionID)
    if (!lines || lines.length === 0) return false
    handoffLines.delete(sessionID)
    const body = [
      `# Handoff from ${AGENT}`,
      `Project: ${cfg.dataset}`,
      "",
      "## What happened this session",
      ...lines,
    ].join("\n")
    try {
      await client.ingestToGraph(body, {
        nodeSet: [`agent:${AGENT}`, `repo:${cfg.dataset}`, "handoff"],
        filename: `handoff-${sessionID}-${uid("h")}.md`,
      })
      status.bump("bridges")
      log(`handoff written to the shared graph (${lines.length} note(s))`)
      return true
    } catch (e) {
      log(`handoff ingest failed: ${String(e)}`)
      status.bump("errors", { lastError: String(e) })
      return false
    }
  }

  // --- hooks ------------------------------------------------------------------

  const hooks: Hooks = {
    tool: {
      cortex_recall,
      cortex_remember,
      cortex_feedback,
      cortex_optimize,
      cortex_forget,
      cortex_handoff,
    },

    // Auto-recall: inject relevant memory before the model answers.
    "chat.message": async (inp, out) => {
      try {
        const text = extractUserText(out.parts)
        if (!text) return
        buffer.openQA(inp.sessionID, text, inp.messageID)

        const items = await client.recall({
          query: text,
          session_id: buffer.cogneeSessionId(inp.sessionID),
          only_context: true,
        })
        status.bump("recalls")
        const mem = formatRecall(items)
        if (!mem) return

        const messageID =
          inp.messageID ?? out.parts.find((p) => p.messageID)?.messageID ?? ""
        out.parts.push({
          id: uid("prt-cognee"),
          sessionID: inp.sessionID,
          messageID,
          type: "text",
          text: `# Relevant memory (from Cognee)\nThe following may be useful context recalled from this project's memory:\n${mem}`,
          synthetic: true,
        })
        log(`injected ${items.length} memory item(s)`)
      } catch (e) {
        log(`chat.message error: ${String(e)}`)
      }
    },

    // Auto-capture: record each agent action as a cheap trace entry.
    "tool.execute.after": async (inp, out) => {
      try {
        if (inp.tool.startsWith("cortex_")) return // never capture our own tools
        const res = await client.rememberEntry(
          traceFromTool(inp, out, cfg.captureToolOutput),
          buffer.cogneeSessionId(inp.sessionID),
        )
        buffer.markDirty(inp.sessionID)
        if (/^(edit|write|multiedit|patch)$/i.test(inp.tool)) {
          note(inp.sessionID, `- ${inp.tool}: ${clip(out.title || out.output || "", 100)}`)
        }
        if (res) status.bump("captures", { lastCapture: inp.tool })
        else status.bump("errors", { lastError: `capture of ${inp.tool} returned no result` })
      } catch (e) {
        log(`capture error: ${String(e)}`)
        status.bump("errors", { lastError: String(e) })
      }
    },

    // Inject memory into the compaction prompt so it survives /compact, and
    // checkpoint-bridge the session while we're at a natural boundary.
    "experimental.session.compacting": async (inp, out) => {
      try {
        const items = await client.recall({
          query:
            "Important decisions, established context, and unresolved tasks for this project.",
          session_id: buffer.cogneeSessionId(inp.sessionID),
          only_context: true,
        })
        const mem = formatRecall(items)
        if (mem) {
          out.context.push(
            `Persistent project memory from Cognee (preserve across compaction):\n${mem}`,
          )
        }
        await buffer.bridge(inp.sessionID, false)
      } catch (e) {
        log(`compacting error: ${String(e)}`)
      }
    },

    // Lifecycle: on idle, pair Q&A and schedule a debounced bridge.
    event: async ({ event }) => {
      try {
        if (event.type !== "session.idle") return
        const sessionID = event.properties?.sessionID
        if (!sessionID) return
        // QA capture embeds text server-side and can be slow, so fire it
        // without blocking; schedule the (debounced) bridge regardless.
        void closeQA(sessionID)
        buffer.scheduleBridge(sessionID)
      } catch (e) {
        log(`event error: ${String(e)}`)
      }
    },

    // On shutdown, flush any pending sessions into the graph.
    dispose: async () => {
      try {
        for (const sid of [...handoffLines.keys()]) await ingestHandoff(sid)
        await buffer.flushAll()
      } catch (e) {
        log(`dispose error: ${String(e)}`)
      }
    },
  }

  return hooks
}

const plugin: PluginModule = { id: "cortex-bridge", server }
export default plugin
