// Cortex Bridge, Kimi Code CLI adapter entry. Kimi runs `bun hook.js <mode>` on
// each lifecycle event and passes the event JSON on stdin. Kimi speaks the same
// hook contract as Claude Code and Codex, so the logic is the shared core
// runtime; only the agent label ("kimi") and the install target differ.
import { runHook } from "@cortex-bridge/core"

await runHook("kimi")
process.exit(0)
