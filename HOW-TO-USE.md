# Using Cortex Bridge

This is the step by step guide to get shared memory running across your coding agents. By the end, a decision you make in OpenCode is recalled in Claude Code, Codex, and Kimi, because all four read and write the same Cognee memory.

The whole idea comes down to two settings that must match across your agents: the same Cognee server, and the same `dataset` name. Set those and they share memory. Everything below is wiring that up.

## What you need

- [Bun](https://bun.sh), a recent version (1.1 or newer), on your PATH. The agent hooks call `bun`, so the agent's own process has to find it too, not just your terminal.
- A running Cognee server, either Cognee Cloud or a self-hosted one (v1.2.1 or newer). Step 1 covers this.
- At least one of the four agents, whichever you actually use:
  - [OpenCode](https://opencode.ai) 1.17.0 or newer (the plugin API this targets)
  - Claude Code
  - [Codex CLI](https://developers.openai.com/codex/cli)
  - [Kimi Code CLI](https://github.com/MoonshotAI/kimi-cli)

On Windows the smoothest path is WSL. Native Windows works too, with two caveats called out in step 4.

## 1. Get a Cognee server

Cortex Bridge talks to a Cognee server over HTTP; it does not run one for you. Pick one:

- Cognee Cloud: sign up, note your instance URL and API key. Nothing to run locally.
- Self-hosted: run Cognee (v1.2.1+) yourself from the [Cognee](https://github.com/topoteretes/cognee) repo. Start it with:
  - `CACHING=true`. The shared memory rides on Cognee's session cache, and it is off without this. `doctor` and `allagents` below will fail if it is not set.
  - `LLM_API_KEY` set (used by recall and the graph build).
  - For local development, `ENABLE_BACKEND_ACCESS_CONTROL=False` and `REQUIRE_AUTHENTICATION=False` so no login is needed. Leave these on and you will need a username and password instead.

Confirm it is up before moving on:

```bash
curl http://localhost:8000/health
```

That should return a healthy status.

## 2. Get Cortex Bridge and build it

```bash
git clone https://github.com/anurag629/cortex-bridge
cd cortex-bridge
bun install
bun run build:all
```

`build:all` prints four `built dist/...` lines, one per package. If you see all four, the OpenCode plugin bundle and the hook binaries for Claude Code, Codex, and Kimi are ready under each package's `dist/`.

One thing to know: the installers in step 4 write the absolute path of these built files into each agent's config. So keep the repo where it is. If you move or delete it later, re-run the installers.

## 3. Configure (one file, and you must set `dataset`)

Every agent reads one JSON config file, so you do not need shell exports. Create it in one of these places:

- One memory everywhere: `~/.config/cortex-bridge/config.json`
- One memory for a single project: `<your-project>/.cortex-bridge/config.json`

`dataset` is the shared key, and it is required for sharing, not optional. If you leave it out, OpenCode and the three CLI agents fall back to different default dataset names for the same repo, so OpenCode ends up on its own memory and does not share with the others. Set the same `dataset` everywhere you want on one memory and this problem disappears. The global config file is the reliable choice, because it is found no matter which directory an agent starts in.

Self-hosted:

```json
{
  "mode": "local",
  "baseUrl": "http://localhost:8000",
  "dataset": "my-team-memory"
}
```

This no-auth example assumes you started Cognee with `REQUIRE_AUTHENTICATION=False` (step 1). If your server has auth on, add `"username"` and `"password"`.

Cognee Cloud:

```json
{
  "mode": "cloud",
  "baseUrl": "https://your-instance.cognee.ai",
  "apiKey": "ck_your_api_key_here",
  "dataset": "my-team-memory"
}
```

There is a starting point at `cortex-bridge.json.example` in the repo root. If you copy it, rename it to `config.json` at one of the paths above, delete the `_comment` lines, and note it defaults to `mode: "cloud"`, so switch that to `local` if you are self-hosting.

Environment variables work too (`CORTEX_MODE`, `CORTEX_BASE_URL`, `CORTEX_API_KEY`, `CORTEX_DATASET`, and the rest), and they win over the file. The file is easier because agents run as separate processes and often do not inherit your shell exports.

## 4. Install the adapter for each agent

Run these from the repo root, after the build in step 2. Restart the agent after installing it.

| Agent | Command (from the repo root) | Writes to |
|---|---|---|
| OpenCode | `bun run packages/adapter-opencode/dist/install.js` | `~/.config/opencode/plugin/cortex-bridge.js` |
| Claude Code | `bun run packages/adapter-claude-code/dist/install.js` | `~/.claude/settings.json` |
| Codex | `bun run packages/adapter-codex/dist/install.js` | `~/.codex/hooks.json` |
| Kimi | `bun run packages/adapter-kimi/dist/install.js` | `~/.kimi/config.toml` |

Every installer is idempotent (re-running never duplicates) and takes `uninstall` to remove its hooks. OpenCode and Claude Code also take `--project` to install into the current repo instead of globally. The Kimi installer writes a managed block between marker comments in `~/.kimi/config.toml` and replaces just that block on re-run, leaving the rest of your config alone.

Codex needs one extra step. It does not run newly installed hooks until you trust them:

1. Install the Codex adapter (above).
2. Start Codex, or restart it if it was already running, so it picks up `~/.codex/hooks.json`.
3. Run `/hooks` inside Codex and trust the cortex-bridge hooks. Until you do, Codex captures and recalls nothing. To skip the prompt, start Codex once with `--dangerously-bypass-hook-trust`.

On native Windows: OpenCode's installer creates a symlink by default, which needs Developer Mode or admin. Append `--copy` to that command to copy the bundle instead. And make sure `bun` is on the PATH the agent process sees, since GUI-launched agents do not always inherit your shell's PATH.

## 5. Check it works

From the repo root, with your server reachable and started with `CACHING=true`:

```bash
bun run smoke      # one round trip: health, remember, recall, bridge
bun run doctor     # two agents, one dataset: A writes, B recalls it
bun run allagents  # the full matrix across OpenCode, Claude Code, Codex, and Kimi
```

What success looks like:

- `smoke` prints `SMOKE OK` and lists the trace it just wrote in the recall output. If health prints `undefined`, the server is not reachable.
- `doctor` prints `DOCTOR PASS`.
- `allagents` prints `ALL-AGENTS PASS`. It records a decision from each of the four agents into the shared memory, then drives the real Codex and Kimi (and Claude Code) hook binaries to recall a decision a different agent made.

These scripts read the same config as the agents. To point them at a specific server for one run, set the vars inline, for example `CORTEX_MODE=local CORTEX_BASE_URL=http://localhost:8000 bun run doctor`.

## 6. What happens when you use it

Once installed, memory works on its own. In each agent:

- On every prompt, relevant memory from the other agents is recalled and added to the context, so the agent starts with what was already decided.
- After each tool call (edits, commands, reads), the action is captured to shared memory.
- When a turn or session ends, a short summary is folded in as a handoff for the next agent.

OpenCode also gets tools the model can call directly: `cortex_recall`, `cortex_remember`, `cortex_feedback`, `cortex_optimize`, `cortex_forget`, and `cortex_handoff`.

The honest test: in OpenCode, make a decision or state a project fact ("we are using jose for JWTs because we are ESM"). Then open Codex or Kimi and ask what you decided about JWTs. It should already know. This works because all of them resolve the same `dataset` you pinned in step 3, so make sure that is set.

## Troubleshooting

- Agents are not sharing. They are almost certainly on different datasets. Pin the same `dataset` in the config file (step 3), preferably the global one. Check OpenCode's status file at `~/.config/cortex-bridge/status.json`; the `dataset` and `connected` fields show what it actually loaded.
- A hook agent does nothing. Make sure `bun` is on the PATH the agent sees, that you restarted the agent after installing, and for Codex that you started or restarted it and trusted the hooks with `/hooks`.
- Nothing is recalled. Check the server is up and was started with `CACHING=true`, then run `bun run doctor`.
- You moved the repo. The hook configs point at absolute paths inside it. Re-run the installers.

## Uninstall

Run any installer with `uninstall`, for example:

```bash
bun run packages/adapter-codex/dist/install.js uninstall
```

## More detail

The [README](README.md) has the full configuration table, the OpenCode hook mapping, and the cloud versus self-hosted differences.
