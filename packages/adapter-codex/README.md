# @cortex-bridge/codex

The Codex CLI adapter for [Cortex Bridge](../../README.md). It gives Codex the same shared memory as your other agents: it recalls what any agent wrote into the project's Cognee memory, and writes Codex's own work back so the others can pick it up.

Codex speaks the same lifecycle-hook contract as Claude Code, so this reuses the shared hook runtime in `@cortex-bridge/core`. There is no Cognee logic here, just an installer and the "codex" label.

## What it does

| Codex hook | What happens |
|---|---|
| `UserPromptSubmit` | recall relevant shared memory and inject it into the prompt (via `additionalContext`) |
| `PostToolUse` | record the tool call as a trace |
| `Stop` | fold Codex's final answer into shared memory as a handoff |

## Install

```bash
bun install
bun run build:adapters   # from the repo root
bun run packages/adapter-codex/dist/install.js
```

That writes the three hooks into `~/.codex/hooks.json` (idempotent, and it strips any prior Cortex Bridge hooks first).

Codex does not run new hooks until you trust them. Run `/hooks` inside Codex to review and trust them, or start it once with `--dangerously-bypass-hook-trust`.

- Remove: append `uninstall`.

## Sharing memory across agents

Pin `CORTEX_DATASET` (or `dataset` in `~/.config/cortex-bridge/config.json`) to the same value here and in your OpenCode, Claude Code, and Kimi adapters. Then a decision made in one tool is recalled in the others.

Verify the whole loop with `bun run allagents` from the repo root.
