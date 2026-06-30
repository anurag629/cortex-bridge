import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "./types"
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

function env(name: string): string | undefined {
  const v = process.env[name]
  return v && v.trim() !== "" ? v.trim() : undefined
}

function asNum(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function asBool(v: unknown): boolean {
  return v === true || v === "true" || v === "1"
}

// OpenCode does not load .env files into the plugin process, and relying on the
// launching shell's exports is fragile. So we also read a JSON config file from
// the OpenCode config dir (and the project's .opencode/). Precedence:
//   env var  >  project .opencode/cognee.json  >  ~/.config/opencode/cognee.json  >  default
function loadFileConfig(input?: Partial<PluginInput>): { data: Record<string, any>; from: string[] } {
  const candidates = [
    join(homedir(), ".config", "opencode", "cognee.json"),
    input?.worktree ? join(input.worktree, ".opencode", "cognee.json") : undefined,
    input?.directory ? join(input.directory, ".opencode", "cognee.json") : undefined,
  ].filter((p): p is string => Boolean(p))

  let data: Record<string, any> = {}
  const from: string[] = []
  for (const p of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8"))
      if (parsed && typeof parsed === "object") {
        data = { ...data, ...parsed } // later files (project) override earlier (global)
        from.push(p)
      }
    } catch {
      // missing or invalid file: ignore
    }
  }
  return { data, from }
}

export function resolveConfig(
  input?: Partial<PluginInput>,
  options?: Record<string, any>,
): CogneeConfig {
  const { data: file, from } = loadFileConfig(input)

  // value precedence helper: env > file > options > default
  const val = (envName: string, key: string, dflt?: any) =>
    env(envName) ?? file[key] ?? options?.[key] ?? dflt

  const mode = (val("COGNEE_MODE", "mode", "local") as CogneeMode)
  const baseUrl = String(val("COGNEE_BASE_URL", "baseUrl", "http://localhost:8000")).replace(/\/+$/, "")
  const apiPrefix = String(val("COGNEE_API_PREFIX", "apiPrefix", "/api/v1"))

  const projectKey =
    input?.project?.id ||
    input?.project?.worktree ||
    input?.worktree ||
    input?.directory ||
    process.cwd()
  const dataset = String(val("COGNEE_DATASET", "dataset", `oc-mem-${slug(String(projectKey))}`))

  const sources: string[] = []
  if (env("COGNEE_BASE_URL") || env("COGNEE_API_KEY") || env("COGNEE_MODE")) sources.push("env")
  sources.push(...from)

  return {
    mode,
    baseUrl,
    apiPrefix,
    username: val("COGNEE_USERNAME", "username"),
    password: val("COGNEE_PASSWORD", "password"),
    apiKey: val("COGNEE_API_KEY", "apiKey"),
    dataset,
    topK: asNum(val("COGNEE_TOP_K", "topK"), 8),
    bridgeDebounceMs: asNum(val("COGNEE_BRIDGE_DEBOUNCE_MS", "bridgeDebounceMs"), 120_000),
    captureToolOutput: (env("COGNEE_CAPTURE_TOOL_OUTPUT") ?? String(file.captureToolOutput ?? "true")) !== "false",
    requestTimeoutMs: asNum(val("COGNEE_REQUEST_TIMEOUT_MS", "requestTimeoutMs"), 30_000),
    recallTimeoutMs: asNum(val("COGNEE_RECALL_TIMEOUT_MS", "recallTimeoutMs"), 10_000),
    debug: asBool(env("COGNEE_DEBUG") ?? file.debug ?? options?.debug ?? false),
    source: sources.length ? sources.join(", ") : "defaults",
  }
}
