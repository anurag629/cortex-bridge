# @anurag629/opencode-cognee

Persistent memory for [OpenCode](https://opencode.ai), backed by [Cognee](https://github.com/topoteretes/cognee).

OpenCode forgets everything between sessions. This plugin gives it a real memory: it auto-captures what the agent does, recalls relevant context before the model answers, keeps that memory alive across `/compact`, and learns from feedback. Everything is stored in a Cognee knowledge graph, one per project.

Built for the WeMakeDevs x Cognee hackathon. Self-hosted first, with a one-flag toggle to Cognee Cloud.

## How it works

The plugin speaks HTTP to a running Cognee server. Capture is cheap (writes to Cognee's session cache, no graph build); the expensive graph build runs once, in the background, at session boundaries.

| OpenCode hook | What happens | Cognee call |
|---|---|---|
| `chat.message` | recall relevant memory and inject it before the model answers | `POST /recall` |
| `tool.execute.after` | record each agent action as a trace | `POST /remember/entry` |
| `experimental.session.compacting` | inject memory into the compaction prompt so it survives `/compact` | `POST /recall` |
| `session.idle` | pair the question with the answer; debounced bridge to the graph | `POST /remember/entry`, `POST /improve` |
| `dispose` | flush pending sessions into the graph | `POST /improve` |

It also exposes three tools the model can call directly: `cognee_recall`, `cognee_remember`, and `cognee_feedback`.

## Server prerequisites

You need a running Cognee server (v1.2.1+). When starting it:

- Set `CACHING=true`. Without it the session cache is unavailable and capture fails.
- Set `LLM_API_KEY` (used by recall completions and the graph build).
- Auth, pick one:
  - Fastest local dev: `ENABLE_BACKEND_ACCESS_CONTROL=False` and `REQUIRE_AUTHENTICATION=False`, then no credentials are needed.
  - Access control on (the default): set `COGNEE_USERNAME` / `COGNEE_PASSWORD` and the plugin logs in.

Then `docker compose up` and confirm `curl localhost:8000/health` returns `{"status":"ready"}`.

## Install

```bash
bun install
bun run build           # produces dist/cognee.plugin.js
bun run link            # symlinks it into ~/.config/opencode/plugin/cognee.js
```

That is it. OpenCode auto-discovers the file globally, no `opencode.json` edits. Restart opencode.

- Project-only install: `bun run dist/install.js --project` (drops it in `./.opencode/plugin/`).
- Copy instead of symlink: add `--copy`.
- Remove: `bun run dist/install.js uninstall`.

Once published you can also run `bunx @anurag629/opencode-cognee` to link it.

## Configuration

You can configure the plugin two ways. A config file is recommended, because OpenCode does not load `.env` files into the plugin and shell exports only apply to the exact shell that launched OpenCode.

**Config file (recommended).** Copy `cognee.json.example` to `~/.config/opencode/cognee.json` (global) or `<project>/.opencode/cognee.json` (per repo):

```json
{
  "mode": "cloud",
  "baseUrl": "https://your-instance.cognee.ai",
  "apiKey": "ck_...",
  "dataset": "my-project-memory"
}
```

**Environment variables.** Same settings, prefixed with `COGNEE_`. Env vars override the file. If you use these, export them in your shell profile (`~/.zshrc`), not just inline, or OpenCode will not see them.

Precedence is env var, then project config file, then global config file, then default.

Settings (env name / file key):

| Var | Default | Purpose |
|---|---|---|
| `COGNEE_MODE` | `local` | `local` (self-hosted) or `cloud` (Cognee Cloud) |
| `COGNEE_BASE_URL` | `http://localhost:8000` | server URL |
| `COGNEE_USERNAME` / `COGNEE_PASSWORD` | - | local login (only if access control is on) |
| `COGNEE_API_KEY` | - | Cognee Cloud auth |
| `COGNEE_DATASET` | `oc-mem-<project>` | per-project memory graph |
| `COGNEE_TOP_K` | `8` | items pulled per recall |
| `COGNEE_BRIDGE_DEBOUNCE_MS` | `120000` | wait before bridging a session to the graph |
| `COGNEE_DEBUG` | `false` | verbose logging to stderr |

## Verify

Check the HTTP path against your server:

```bash
bun run smoke      # health -> remember -> recall -> improve
```

Confirm the plugin itself is connected and pointed at the right server. After OpenCode loads it, inspect the status file it writes:

```bash
cat ~/.config/opencode/cognee-status.json
```

```json
{
  "connected": true,
  "baseUrl": "https://your-instance.cognee.ai",
  "dataset": "my-project-memory",
  "auth": "api-key",
  "captures": 12,
  "recalls": 5,
  "configSource": "/Users/you/.config/opencode/cognee.json"
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
