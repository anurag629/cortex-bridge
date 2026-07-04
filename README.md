# Cortex Bridge

One memory graph, every coding agent. A shared, cross-agent memory layer backed by [Cognee](https://github.com/topoteretes/cognee): capture a decision in one agent, resume it in any other.

Most AI coding agents forget everything between sessions, and none of them share memory with each other. Cortex Bridge fixes both. A runtime-agnostic core (`@cortex-bridge/core`) talks to a Cognee knowledge graph, and thin per-agent adapters wire it into each tool. Work in [OpenCode](https://opencode.ai), then open Claude Code or Cursor in the same repo, and the agent already knows what you changed and why.

Built for the WeMakeDevs x Cognee hackathon. Runs fully local (self-hosted Cognee on Ollama, no external API) with a one-flag toggle to Cognee Cloud.

This repo is a workspace:

- `packages/core` is the runtime-agnostic memory engine. It owns the full Cognee lifecycle (remember, recall, improve/memify, forget) and the shared hook runtime, and knows nothing about any specific agent.
- `packages/adapter-opencode` is the OpenCode adapter, the reference native integration documented below.
- `packages/adapter-claude-code`, `packages/adapter-codex`, and `packages/adapter-kimi` wire the same core into Claude Code, Codex CLI, and Kimi Code CLI. Those three speak the same lifecycle-hook contract, so they share one hook binary; each adapter is basically an installer plus a label.

Four agents, one memory. A decision recorded in any of them is recalled in the others, because they all read and write the same Cognee dataset. Cognee ships its own single-agent plugins, including a basic OpenCode one. Cortex Bridge is the deeper cross-agent take: one shared graph across a fleet of agents, not memory trapped inside one tool.

### How the sharing actually works

Every agent on a repo derives the same session id from the dataset (`cortex-<dataset>`) and reads and writes Cognee's session cache under it. That cache is the reliable cross-agent path: a write shows up in another agent instantly, with no graph build in the way. Session summaries also fold into the knowledge graph as durable handoffs, but the day-to-day "you already know what I just did" comes from the shared session. Pin the same `CORTEX_DATASET` across your agents and they are on the same memory.

## How the OpenCode adapter works

The adapter speaks HTTP to a running Cognee server through the core. Capture is cheap (writes to Cognee's session cache, no graph build); the expensive graph build runs once, in the background, at session boundaries.

| OpenCode hook | What happens | Cognee call |
|---|---|---|
| `chat.message` | recall relevant memory and inject it before the model answers | `POST /recall` |
| `tool.execute.after` | record each agent action as a trace | `POST /remember/entry` |
| `experimental.session.compacting` | inject memory into the compaction prompt so it survives `/compact` | `POST /recall` |
| `session.idle` | pair the question with the answer; debounced bridge to the graph | `POST /remember/entry`, `POST /improve` |
| `dispose` | flush pending sessions into the graph | `POST /improve` |

It also exposes five tools the model can call directly: `cortex_recall`, `cortex_remember`, `cortex_feedback`, `cortex_optimize` (run `memify` to consolidate and reweight the graph), and `cortex_forget` (prune stored memory). Together these exercise the full Cognee lifecycle: remember, recall, improve/memify, and forget.

## Server prerequisites

You need a running Cognee server (v1.2.1+). When starting it:

- Set `CACHING=true`. Without it the session cache is unavailable and capture fails.
- Set `LLM_API_KEY` (used by recall completions and the graph build).
- Auth, pick one:
  - Fastest local dev: `ENABLE_BACKEND_ACCESS_CONTROL=False` and `REQUIRE_AUTHENTICATION=False`, then no credentials are needed.
  - Access control on (the default): set `CORTEX_USERNAME` / `CORTEX_PASSWORD` and the plugin logs in.

Then `docker compose up` and confirm `curl localhost:8000/health` returns `{"status":"ready"}`.

## Install

```bash
bun install
bun run build   # -> packages/adapter-opencode/dist/cortex-bridge.plugin.js
bun run packages/adapter-opencode/dist/install.js   # symlink -> ~/.config/opencode/plugin/cortex-bridge.js
```

That is it. OpenCode auto-discovers the file globally, no `opencode.json` edits. Restart opencode.

- Project-only install: append `--project` (drops it in `./.opencode/plugin/`).
- Copy instead of symlink: append `--copy`.
- Remove: append `uninstall`.

Once published you can also run `bunx @cortex-bridge/opencode` to link it.

## Add the other agents

Claude Code, Codex, and Kimi drive the same shared memory through lifecycle hooks. Build the adapters once, then run the installer for each agent you use. Point them all at the same server and dataset and they share memory with OpenCode and with each other.

```bash
bun run build:adapters   # builds the Claude Code, Codex, and Kimi hook binaries

bun run packages/adapter-claude-code/dist/install.js   # -> ~/.claude/settings.json
bun run packages/adapter-codex/dist/install.js         # -> ~/.codex/hooks.json
bun run packages/adapter-kimi/dist/install.js          # -> ~/.kimi/config.toml
```

Each installer is idempotent (re-running never duplicates) and each takes `uninstall` to remove its hooks cleanly. What they wire in is the same three hooks: recall shared memory on prompt submit, capture tool calls, and fold the final answer into memory when a turn ends.

Two agent-specific notes:

- Codex skips new hooks until you trust them. Run `/hooks` inside Codex to review and trust them, or start it once with `--dangerously-bypass-hook-trust`.
- The Kimi installer appends a small block to `~/.kimi/config.toml` between sentinel comments and leaves the rest of your config untouched.

For sharing, set the same `CORTEX_DATASET` (and `CORTEX_BASE_URL`) for every agent, in your shell profile or the config file below.

## Configuration

You can configure the plugin two ways. A config file is recommended, because OpenCode does not load `.env` files into the plugin and shell exports only apply to the exact shell that launched OpenCode.

**Config file (recommended).** Copy `cortex-bridge.json.example` to `~/.config/cortex-bridge/config.json` (global) or `<project>/.cortex-bridge/config.json` (per repo). The legacy `~/.config/opencode/cognee.json` path is still read for continuity:

```json
{
  "mode": "cloud",
  "baseUrl": "https://your-instance.cognee.ai",
  "apiKey": "ck_...",
  "dataset": "my-project-memory"
}
```

**Environment variables.** Same settings, prefixed with `CORTEX_` (the legacy `COGNEE_` prefix still works). Env vars override the file. If you use these, export them in your shell profile (`~/.zshrc`), not just inline, or OpenCode will not see them.

Precedence is env var, then project config file, then global config file, then default.

Settings (env name / file key):

| Var | Default | Purpose |
|---|---|---|
| `CORTEX_MODE` | `local` | `local` (self-hosted) or `cloud` (Cognee Cloud) |
| `CORTEX_BASE_URL` | `http://localhost:8000` | server URL |
| `CORTEX_USERNAME` / `CORTEX_PASSWORD` | - | local login (only if access control is on) |
| `CORTEX_API_KEY` | - | Cognee Cloud auth |
| `CORTEX_DATASET` | `cortex-<project>` | shared memory graph; pin the same value across agents to share |
| `CORTEX_TOP_K` | `8` | items pulled per recall |
| `CORTEX_BRIDGE_DEBOUNCE_MS` | `120000` | wait before bridging a session to the graph |
| `CORTEX_DEBUG` | `false` | verbose logging to stderr |

## Verify

Check the HTTP path against your server:

```bash
bun run smoke       # health -> remember -> recall -> improve
bun run doctor      # two agents, one dataset: A writes, B recalls it
bun run allagents   # the full matrix across OpenCode, Claude Code, Codex, and Kimi
```

`allagents` records a decision "from" each of the four agents into the shared session, then drives the real Codex and Kimi hook binaries (and the Claude Code one) to recall a decision a different agent made. It passes only if every write crosses over to another agent.

Confirm the plugin itself is connected and pointed at the right server. After OpenCode loads it, inspect the status file it writes:

```bash
cat ~/.config/cortex-bridge/status.json
```

```json
{
  "connected": true,
  "baseUrl": "https://your-instance.cognee.ai",
  "dataset": "my-project-memory",
  "auth": "api-key",
  "captures": 12,
  "recalls": 5,
  "configSource": "/Users/you/.config/cortex-bridge/config.json"
}
```

If `baseUrl` says `http://localhost:8000` when you meant cloud, your config is not reaching the plugin (fix the file or shell exports). If `captures` stays at 0 while you use the agent, capture is failing (check `connected` and `errors`).

Then prove memory across sessions: in one session let the agent make a change or tell it a project fact, quit, open a fresh session in the same repo, and ask about it.

## Notes

- Targets the stable OpenCode V1 plugin API; `engines.opencode` is pinned to `>=1.17.0`.
- The bundle has zero runtime dependencies (only `fetch`).
- This project was built with AI assistance (declared per hackathon rules).

### Cloud vs self-hosted

Capture, same-session recall, and compaction survival work on both. Cross-session memory needs the knowledge graph, which Cognee builds with an LLM (`cognify`). On a self-hosted server you control that. On Cognee Cloud, the tenant must have a working LLM endpoint, or `cognify` times out and the graph never builds, so memory will not carry across separate sessions. Same-session recall falls back to the session cache and works regardless.

## License

MIT
