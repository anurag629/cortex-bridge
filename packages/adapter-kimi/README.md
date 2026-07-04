# @cortex-bridge/kimi

The Kimi Code CLI adapter for [Cortex Bridge](../../README.md). It gives Kimi the same shared memory as your other agents: it recalls what any agent wrote into the project's Cognee memory, and writes Kimi's own work back so the others can pick it up.

Kimi speaks the same lifecycle-hook contract as Claude Code and Codex, so this reuses the shared hook runtime in `@cortex-bridge/core`. There is no Cognee logic here, just an installer and the "kimi" label.

## What it does

| Kimi hook | What happens |
|---|---|
| `UserPromptSubmit` | recall relevant shared memory and inject it into the prompt (via `additionalContext`) |
| `PostToolUse` | record the tool call as a trace |
| `Stop` | fold Kimi's final answer into shared memory as a handoff |

## Install

```bash
bun install
bun run build:adapters   # from the repo root
bun run packages/adapter-kimi/dist/install.js
```

That appends a small `[[hooks]]` block to `~/.kimi/config.toml`, wrapped in sentinel comments so the rest of your config is untouched. Re-running is idempotent (it replaces the managed block). Restart Kimi.

- Remove: append `uninstall`.

## Sharing memory across agents

Pin `CORTEX_DATASET` (or `dataset` in `~/.config/cortex-bridge/config.json`) to the same value here and in your OpenCode, Claude Code, and Codex adapters. Then a decision made in one tool is recalled in the others.

Verify the whole loop with `bun run allagents` from the repo root.
