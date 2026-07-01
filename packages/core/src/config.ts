import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { WorkspaceIdentity } from "./types"
import { slug } from "./util"

export type CogneeMode = "local" | "cloud"

export interface CogneeConfig {
  mode: CogneeMode
  baseUrl: string
  apiPrefix: string // "/api/v1" for both local and hosted; override if a gateway strips it
  username?: string
  password?: string
  apiKey?: string
  dataset: string
  topK: number
  bridgeDebounceMs: number
  captureToolOutput: boolean
  requestTimeoutMs: number
  recallTimeoutMs: number
  debug: boolean
  source: string // where config came from, for the status file
}

// Read an env var by suffix, preferring the CORTEX_ prefix and falling back to
// the legacy COGNEE_ prefix so older setups keep working. So CORTEX_BASE_URL
// wins, then COGNEE_BASE_URL.
function env(suffix: string): string | undefined {
  for (const name of [`CORTEX_${suffix}`, `COGNEE_${suffix}`]) {
    const v = process.env[name]
    if (v && v.trim() !== "") return v.trim()
  }
  return undefined
}

function asNum(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function asBool(v: unknown): boolean {
  return v === true || v === "true" || v === "1"
}

// Hosts rarely load .env into the agent process and shell exports are fragile,
// so we also read a JSON config file. We check the Cortex Bridge locations and,
// for continuity, the legacy OpenCode ones. Precedence: an env var beats every
// file; a project file beats a global one; and the newer cortex-bridge path
// beats the legacy opencode path at the same level.
function loadFileConfig(id?: WorkspaceIdentity): { data: Record<string, any>; from: string[] } {
  const projectDirs = [id?.worktree, id?.directory].filter((p): p is string => Boolean(p))
  const candidates = [
    join(homedir(), ".config", "opencode", "cognee.json"), // legacy global
    join(homedir(), ".config", "cortex-bridge", "config.json"), // global (wins over legacy)
    ...projectDirs.flatMap((d) => [
      join(d, ".opencode", "cognee.json"), // legacy project
      join(d, ".cortex-bridge", "config.json"), // project (wins)
    ]),
  ]

  let data: Record<string, any> = {}
  const from: string[] = []
  for (const p of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8"))
      if (parsed && typeof parsed === "object") {
        data = { ...data, ...parsed } // later files override earlier
        from.push(p)
      }
    } catch {
      // missing or invalid file: ignore
    }
  }
  return { data, from }
}

export function resolveConfig(id?: WorkspaceIdentity, options?: Record<string, any>): CogneeConfig {
  const { data: file, from } = loadFileConfig(id)

  // value precedence helper: env (CORTEX_ then COGNEE_) > file > options > default
  const val = (suffix: string, key: string, dflt?: any) =>
    env(suffix) ?? file[key] ?? options?.[key] ?? dflt

  const mode = val("MODE", "mode", "local") as CogneeMode
  const baseUrl = String(val("BASE_URL", "baseUrl", "http://localhost:8000")).replace(/\/+$/, "")
  const apiPrefix = String(val("API_PREFIX", "apiPrefix", "/api/v1"))

  const projectKey = id?.projectId || id?.worktree || id?.directory || process.cwd()
  const dataset = String(val("DATASET", "dataset", `cortex-${slug(String(projectKey))}`))

  const sources: string[] = []
  if (env("BASE_URL") || env("API_KEY") || env("MODE")) sources.push("env")
  sources.push(...from)

  return {
    mode,
    baseUrl,
    apiPrefix,
    username: val("USERNAME", "username"),
    password: val("PASSWORD", "password"),
    apiKey: val("API_KEY", "apiKey"),
    dataset,
    topK: asNum(val("TOP_K", "topK"), 8),
    bridgeDebounceMs: asNum(val("BRIDGE_DEBOUNCE_MS", "bridgeDebounceMs"), 120_000),
    captureToolOutput:
      (env("CAPTURE_TOOL_OUTPUT") ?? String(file.captureToolOutput ?? "true")) !== "false",
    requestTimeoutMs: asNum(val("REQUEST_TIMEOUT_MS", "requestTimeoutMs"), 30_000),
    recallTimeoutMs: asNum(val("RECALL_TIMEOUT_MS", "recallTimeoutMs"), 10_000),
    debug: asBool(env("DEBUG") ?? file.debug ?? options?.debug ?? false),
    source: sources.length ? sources.join(", ") : "defaults",
  }
}
