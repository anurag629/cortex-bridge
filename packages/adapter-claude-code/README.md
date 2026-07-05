# @cortex-bridge/claude-code

The Claude Code adapter for [Cortex Bridge](../../README.md). It gives Claude Code the same shared memory as your other agents: it recalls what any agent wrote into the project's Cognee graph, and writes Claude's own work back as handoffs.

It reuses `@cortex-bridge/core`, so there is no Cognee logic here, just three thin Claude Code hooks that call the core.

## What it does

| Claude Code hook | What happens |
|---|---|
| `UserPromptSubmit` | recall relevant shared memory and inject it into the prompt (via `additionalContext`) |
| `PostToolUse` | record the tool call as a trace |
| `Stop` | write a handoff of what Claude did into the shared graph |

## Install

```bash
bun install
bun run build   # from the repo root
bun run packages/adapter-claude-code/dist/install.js
```

That wires the three hooks into `~/.claude/settings.json` (idempotent, and it strips any prior Cortex Bridge hooks first). Restart Claude Code.

- Project-only: append `--project` (writes `./.claude/settings.json`).
- Remove: append `uninstall`.

## Sharing memory across agents

Cross-agent sharing needs one thing: the same dataset. Pin `CORTEX_DATASET` (or `dataset` in `~/.config/cortex-bridge/config.json`) to the same value here and in your other Cortex Bridge adapters (OpenCode, Codex, Kimi). Then a decision made in one tool is recalled in the others.

Verify the whole loop with `bun run doctor` from the repo root.
