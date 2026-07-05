// The one-command setup wizard. `bun run setup` runs this after `bun install`.
// It detects which agents you have, asks what to wire up and where, then builds,
// writes the config, installs each adapter, checks the server, and offers to
// verify. It reuses the existing adapter installers (spawned as child processes)
// and the core client, so nothing here reimplements install logic.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import * as p from "@clack/prompts"
import { CogneeClient, cortexConfigPath, resolveConfig } from "@cortex-bridge/core"

const REPO_ROOT = resolve(import.meta.dir, "..")

type AgentId = "opencode" | "claude-code" | "codex" | "kimi"
type Scope = "global" | "project"

interface AgentSpec {
  id: AgentId
  label: string
  installer: string // path (relative to repo root) to the built installer
  supportsProject: boolean
  // How to tell the agent is present, and whether we already wired it.
  presentDir: string // relative to home; its existence means the agent is installed
  wiredCheck: (home: string) => boolean
}

// One row per agent. The wiredCheck looks for our marker in the agent's config.
export const AGENTS: AgentSpec[] = [
  {
    id: "opencode",
    label: "OpenCode",
    installer: "packages/adapter-opencode/dist/install.js",
    supportsProject: true,
    presentDir: ".config/opencode",
    wiredCheck: (h) => existsSync(join(h, ".config/opencode/plugin/cortex-bridge.js")),
  },
  {
    id: "claude-code",
    label: "Claude Code",
    installer: "packages/adapter-claude-code/dist/install.js",
    supportsProject: true,
    presentDir: ".claude",
    wiredCheck: (h) => fileHas(join(h, ".claude/settings.json"), "cortex-bridge"),
  },
  {
    id: "codex",
    label: "Codex",
    installer: "packages/adapter-codex/dist/install.js",
    supportsProject: false,
    presentDir: ".codex",
    wiredCheck: (h) => fileHas(join(h, ".codex/hooks.json"), "cortex-bridge"),
  },
  {
    id: "kimi",
    label: "Kimi",
    installer: "packages/adapter-kimi/dist/install.js",
    supportsProject: false,
    presentDir: ".kimi",
    wiredCheck: (h) => fileHas(join(h, ".kimi/config.toml"), "cortex-bridge (managed)"),
  },
]

function fileHas(path: string, needle: string): boolean {
  try {
    return readFileSync(path, "utf8").includes(needle)
  } catch {
    return false
  }
}

export interface Answers {
  mode: "local" | "cloud"
  baseUrl: string
  apiKey?: string
  username?: string
  password?: string
  dataset: string
}

// --- reusable execution helpers (also imported by scripts/remove.ts) ---------

export function detectAgents(home = homedir()): Record<AgentId, { installed: boolean; wired: boolean }> {
  const out = {} as Record<AgentId, { installed: boolean; wired: boolean }>
  for (const a of AGENTS) {
    out[a.id] = { installed: existsSync(join(home, a.presentDir)), wired: a.wiredCheck(home) }
  }
  return out
}

export async function ensureBuilt(): Promise<boolean> {
  const needed = [
    "packages/adapter-opencode/dist/cortex-bridge.plugin.js",
    "packages/adapter-opencode/dist/install.js",
    "packages/adapter-claude-code/dist/hook.js",
    "packages/adapter-codex/dist/hook.js",
    "packages/adapter-kimi/dist/hook.js",
  ]
  if (needed.every((f) => existsSync(join(REPO_ROOT, f)))) return true
  const proc = Bun.spawn(["bun", "run", "build:all"], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" })
  return (await proc.exited) === 0
}

export function writeConfig(scope: Scope, answers: Answers, projectDir = process.cwd()): string {
  const path = cortexConfigPath(scope, projectDir)
  let existing: Record<string, any> = {}
  try {
    existing = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    // no file yet, or unreadable: start clean
  }
  const next: Record<string, any> = {
    ...existing,
    mode: answers.mode,
    baseUrl: answers.baseUrl,
    dataset: answers.dataset,
  }
  if (answers.apiKey) next.apiKey = answers.apiKey
  else delete next.apiKey
  if (answers.username) next.username = answers.username
  if (answers.password) next.password = answers.password
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n")
  return path
}

export async function runInstaller(
  agent: AgentSpec,
  opts: { scope?: Scope; projectDir?: string; uninstall?: boolean },
): Promise<{ ok: boolean; output: string }> {
  const args = [join(REPO_ROOT, agent.installer)]
  if (opts.uninstall) {
    args.push("uninstall")
  } else {
    if (opts.scope === "project" && agent.supportsProject) args.push("--project")
    if (agent.id === "opencode" && process.platform === "win32") args.push("--copy")
  }
  const cwd = opts.scope === "project" && opts.projectDir ? opts.projectDir : REPO_ROOT
  const proc = Bun.spawn(["bun", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { ok: code === 0, output: (out + err).trim() }
}

export async function healthCheck(answers: Answers): Promise<{ status?: string; version?: string } | undefined> {
  const cfg = resolveConfig(undefined, { ...answers })
  // Force the answers over any stale env var, so we test what was entered.
  cfg.baseUrl = answers.baseUrl.replace(/\/+$/, "")
  cfg.mode = answers.mode
  if (answers.apiKey) cfg.apiKey = answers.apiKey
  const client = new CogneeClient(cfg, () => {})
  return client.health()
}

export async function runVerify(kind: "doctor" | "allagents", answers: Answers): Promise<boolean> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    CORTEX_MODE: answers.mode,
    CORTEX_BASE_URL: answers.baseUrl,
    CORTEX_DATASET: answers.dataset,
  }
  if (answers.apiKey) env.CORTEX_API_KEY = answers.apiKey
  const proc = Bun.spawn(["bun", "run", kind], { cwd: REPO_ROOT, env, stdout: "inherit", stderr: "inherit" })
  return (await proc.exited) === 0
}

// Remove the cortex-bridge config directory (config.json + status.json) and the
// per-project one, if present. Returns what was deleted.
export function removeAllConfig(projectDir = process.cwd()): string[] {
  const removed: string[] = []
  const targets = [join(homedir(), ".config", "cortex-bridge"), join(projectDir, ".cortex-bridge")]
  for (const t of targets) {
    if (existsSync(t)) {
      rmSync(t, { recursive: true, force: true })
      removed.push(t)
    }
  }
  return removed
}

// --- the interactive flow ----------------------------------------------------

function bail<T>(v: T | symbol): T {
  if (p.isCancel(v)) {
    p.cancel("Cancelled. Nothing changed.")
    process.exit(0)
  }
  return v as T
}

const httpValidate = (v: string | undefined) =>
  v && !/^https?:\/\//.test(v) ? "Must start with http:// or https://" : undefined

async function doSetup(detected: ReturnType<typeof detectAgents>): Promise<void> {
  const chosen = bail(
    await p.multiselect({
      message: "Which agents should share memory?",
      options: AGENTS.map((a) => ({
        value: a.id,
        label: a.label,
        hint: detected[a.id].wired ? "already wired" : detected[a.id].installed ? "detected" : "not detected",
      })),
      initialValues: AGENTS.filter((a) => detected[a.id].installed).map((a) => a.id),
      required: true,
    }),
  ) as AgentId[]

  const mode = bail(
    await p.select({
      message: "Where does your Cognee memory live?",
      options: [
        { value: "local", label: "Local (self-hosted)" },
        { value: "cloud", label: "Cognee Cloud" },
      ],
      initialValue: "local",
    }),
  ) as "local" | "cloud"

  let baseUrl: string
  let apiKey: string | undefined
  let username: string | undefined
  let password: string | undefined

  if (mode === "local") {
    baseUrl = bail(
      await p.text({
        message: "Server URL",
        placeholder: "http://localhost:8000",
        initialValue: "http://localhost:8000",
        validate: httpValidate,
      }),
    ) as string
    const needAuth = bail(await p.confirm({ message: "Does your server require a login?", initialValue: false }))
    if (needAuth) {
      username = bail(await p.text({ message: "Username" })) as string
      password = bail(await p.password({ message: "Password" })) as string
    }
  } else {
    baseUrl = bail(
      await p.text({
        message: "Cognee Cloud URL",
        placeholder: "https://your-instance.cognee.ai",
        validate: (v) => (!v ? "Required" : httpValidate(v)),
      }),
    ) as string
    apiKey = bail(await p.password({ message: "API key" })) as string
  }

  const dataset = bail(
    await p.text({
      message: "Dataset name (the shared key; keep it the same across agents)",
      initialValue: "team-memory",
      validate: (v) => (!v?.trim() ? "Required" : undefined),
    }),
  ) as string

  const scope = bail(
    await p.select({
      message: "Where should this apply?",
      options: [
        { value: "global", label: "Everywhere (recommended)", hint: "~/.config/cortex-bridge" },
        { value: "project", label: "One project only", hint: "a .cortex-bridge in that repo" },
      ],
      initialValue: "global",
    }),
  ) as Scope

  let projectDir = process.cwd()
  if (scope === "project") {
    projectDir = bail(
      await p.text({ message: "Path to your project", initialValue: process.cwd() }),
    ) as string
  }

  const answers: Answers = { mode, baseUrl, apiKey, username, password, dataset }

  p.log.message(
    [
      `Agents:  ${chosen.join(", ")}`,
      `Server:  ${mode} (${baseUrl})`,
      `Dataset: ${dataset}`,
      `Scope:   ${scope}${scope === "project" ? ` (${projectDir})` : ""}`,
    ].join("\n"),
  )
  if (scope === "project" && chosen.some((id) => id === "codex" || id === "kimi")) {
    p.log.warn("Codex and Kimi wire in globally; project scope applies to OpenCode and Claude Code only.")
  }
  const go = bail(await p.confirm({ message: "Proceed?", initialValue: true }))
  if (!go) {
    p.cancel("Nothing changed.")
    process.exit(0)
  }

  const s = p.spinner()

  s.start("Building (the first run can take a moment)")
  const built = await ensureBuilt()
  s.stop(built ? "Build ready" : "Build failed")
  if (!built) {
    p.log.error("Build failed. Run `bun run build:all` from the repo root to see the error.")
    process.exit(1)
  }

  const cfgPath = writeConfig(scope, answers, projectDir)
  p.log.success(`Wrote config -> ${cfgPath}`)

  for (const id of chosen) {
    const agent = AGENTS.find((a) => a.id === id)!
    s.start(`Wiring ${agent.label}`)
    const r = await runInstaller(agent, { scope, projectDir, uninstall: false })
    s.stop(r.ok ? `Wired ${agent.label}` : `${agent.label} failed`)
    if (!r.ok) p.log.error(r.output || "installer error")
  }

  s.start("Checking the Cognee server")
  const health = await healthCheck(answers)
  s.stop(health ? `Cognee reachable (v${health.version ?? "?"})` : "Cognee not reachable")
  if (!health) {
    p.log.warn(
      mode === "local"
        ? "Start Cognee with CACHING=true and it will connect. See HOW-TO-USE.md."
        : "Double-check your Cloud URL and API key.",
    )
  }

  const steps = ["Restart the agents you wired so they pick up the change."]
  if (chosen.includes("codex")) {
    steps.push("In Codex, run /hooks and trust the cortex-bridge hooks (or start once with --dangerously-bypass-hook-trust).")
  }
  p.log.message(steps.map((x) => `• ${x}`).join("\n"))

  const verifyNow = bail(await p.confirm({ message: "Run a quick verification now (doctor)?", initialValue: true }))
  if (verifyNow) {
    p.log.step("Running doctor...")
    const ok = await runVerify("doctor", answers)
    if (ok) p.log.success("doctor passed: two agents shared one memory.")
    else p.log.warn("doctor did not pass. Check the server is up with CACHING=true. Full matrix: bun run allagents")
  }

  p.outro("Done. Your agents now share one memory.")
}

async function doUninstall(detected: ReturnType<typeof detectAgents>): Promise<void> {
  const toRemove = bail(
    await p.multiselect({
      message: "Remove Cortex Bridge from which agents?",
      options: AGENTS.map((a) => ({
        value: a.id,
        label: a.label,
        hint: detected[a.id].wired ? "wired" : "not wired",
      })),
      initialValues: AGENTS.filter((a) => detected[a.id].wired).map((a) => a.id),
      required: false,
    }),
  ) as AgentId[]

  const alsoConfig = bail(
    await p.confirm({ message: "Also delete the config files (config.json and status)?", initialValue: true }),
  )

  if (toRemove.length === 0 && !alsoConfig) {
    p.outro("Nothing to do.")
    return
  }

  const s = p.spinner()
  for (const id of toRemove) {
    const agent = AGENTS.find((a) => a.id === id)!
    s.start(`Removing ${agent.label}`)
    const r = await runInstaller(agent, { uninstall: true })
    s.stop(r.ok ? `Removed ${agent.label}` : `${agent.label}: nothing to remove`)
  }
  if (alsoConfig) {
    const removed = removeAllConfig()
    p.log.success(removed.length ? `Deleted ${removed.join(", ")}` : "No config files to delete")
  }
  p.outro("Cortex Bridge removed.")
}

async function main(): Promise<void> {
  if (!process.stdout.isTTY) {
    console.log("This wizard needs an interactive terminal. See HOW-TO-USE.md for the manual steps.")
    process.exit(0)
  }
  p.intro("Cortex Bridge setup")

  const detected = detectAgents()
  const present = AGENTS.filter((a) => detected[a.id].installed).map((a) => a.label)
  const wired = AGENTS.filter((a) => detected[a.id].wired).map((a) => a.label)
  p.log.message(
    [
      present.length ? `Detected: ${present.join(", ")}` : "No supported agents detected (you can still pick any).",
      wired.length ? `Already wired: ${wired.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  )

  const action = bail(
    await p.select({
      message: "What do you want to do?",
      options: [
        { value: "setup", label: "Set up memory sharing", hint: "install and configure" },
        { value: "uninstall", label: "Uninstall", hint: "remove hooks and config" },
        { value: "verify", label: "Verify only", hint: "run the doctor check" },
      ],
      initialValue: "setup",
    }),
  ) as "setup" | "uninstall" | "verify"

  if (action === "verify") {
    const cfg = resolveConfig()
    p.log.message(`Using ${cfg.mode} ${cfg.baseUrl}, dataset "${cfg.dataset}"`)
    p.log.step("Running doctor...")
    const ok = await runVerify("doctor", {
      mode: cfg.mode,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      dataset: cfg.dataset,
    })
    if (ok) p.outro("doctor passed. Memory crosses agents.")
    else p.outro("doctor did not pass. Check the server (CACHING=true) and your config.")
    return
  }

  if (action === "uninstall") return doUninstall(detected)
  return doSetup(detected)
}

if (import.meta.main) await main()
