// Cortex Bridge, Claude Code adapter entry. Claude Code runs `bun hook.js <mode>`
// on each lifecycle event and passes the event JSON on stdin. The logic lives in
// the shared core runtime so Claude Code, Codex, and Kimi all behave identically
// and share one memory. The mode comes from argv[2]; the agent label defaults to
// "claude-code" and can be overridden with CORTEX_AGENT.
import { runHook } from "@cortex-bridge/core"

await runHook("claude-code")
process.exit(0)
