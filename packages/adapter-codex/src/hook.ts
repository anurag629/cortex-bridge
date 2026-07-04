// Cortex Bridge, Codex CLI adapter entry. Codex runs `bun hook.js <mode>` on
// each lifecycle event and passes the event JSON on stdin. Codex speaks the same
// hook contract as Claude Code and Kimi, so the logic is the shared core runtime;
// only the agent label ("codex") and the install target differ.
import { runHook } from "@cortex-bridge/core"

await runHook("codex")
process.exit(0)
