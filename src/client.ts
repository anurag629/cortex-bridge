import type { CogneeConfig } from "./config"
import type {
  ForgetRequest,
  HealthResponse,
  ImproveRequest,
  MemoryEntry,
  RecallItem,
  RecallRequest,
  RememberEntryRequest,
  RememberResult,
} from "./types"

type Logger = (msg: string, ...args: any[]) => void

// Thin HTTP client over a running Cognee server. The same client targets a
// self-hosted server (mode=local, /api/v1 prefix, JWT login) and Cognee Cloud
// (mode=cloud, no prefix, X-Api-Key) by toggling config only.
export class CogneeClient {
  private token?: string
  private authResolved = false
  private bridgeSupported = true // /improve exists on self-hosted, not on Cognee Cloud

  constructor(
    private cfg: CogneeConfig,
    private log: Logger,
  ) {}

  private url(path: string): string {
    return `${this.cfg.baseUrl}${this.cfg.apiPrefix}${path}`
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...(extra ?? {}) }
    if (this.cfg.apiKey) h["X-Api-Key"] = this.cfg.apiKey
    else if (this.token) h["Authorization"] = `Bearer ${this.token}`
    return h
  }

  // Resolve auth once. Cloud uses an API key; local with access control on uses
  // a JWT from /auth/login; local with auth off needs nothing.
  async ensureAuth(): Promise<void> {
    if (this.authResolved) return
    this.authResolved = true
    if (this.cfg.apiKey) return
    if (!this.cfg.username || !this.cfg.password) return
    try {
      const body = new URLSearchParams({
        username: this.cfg.username,
        password: this.cfg.password,
      })
      const res = await fetch(this.url("/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      })
      if (!res.ok) {
        this.log(`login failed: ${res.status}`)
        return
      }
      const json: any = await res.json()
      this.token = json?.access_token
      if (this.token) this.log("authenticated with Cognee")
    } catch (e) {
      this.log(`login error: ${String(e)}`)
    }
  }

  private async req<T>(
    method: string,
    path: string,
    jsonBody?: unknown,
    opts?: { retries?: number; timeoutMs?: number },
  ): Promise<T | undefined> {
    await this.ensureAuth()
    const retries = opts?.retries ?? 2
    const timeoutMs = opts?.timeoutMs ?? this.cfg.requestTimeoutMs
    let lastErr: unknown
    let lastStatus = 0
    let aborted = false
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), timeoutMs)
      try {
        const res = await fetch(this.url(path), {
          method,
          headers: this.authHeaders(
            jsonBody !== undefined ? { "Content-Type": "application/json" } : undefined,
          ),
          body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
          signal: ac.signal,
        })
        lastStatus = res.status

        if (res.status === 401 && !this.cfg.apiKey) {
          // token likely expired; force one re-auth then retry
          this.authResolved = false
          this.token = undefined
          await this.ensureAuth()
        }

        if (res.ok) {
          const ct = res.headers.get("content-type") ?? ""
          if (ct.includes("application/json")) return (await res.json()) as T
          return (await res.text()) as unknown as T
        }

        const text = await res.text().catch(() => "")
        lastErr = new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`)
        // Client errors (404 not-found, 404 recall-prerequisites, 403) are
        // expected and handled by callers, so stop without retrying.
        if (res.status >= 400 && res.status < 500 && res.status !== 401) break
      } catch (e) {
        lastErr = e
        // A timeout abort won't succeed on immediate retry (the server is just
        // slow), so stop here instead of burning retries * timeout.
        if (e instanceof Error && e.name === "AbortError") {
          aborted = true
          break
        }
      } finally {
        clearTimeout(timer)
      }
      if (attempt < retries) await sleep(200 * (attempt + 1))
    }
    // Only surface genuinely unexpected failures: server errors (5xx) or
    // network problems. Handled 4xx and timeouts stay quiet so the plugin
    // never spams OpenCode's UI with conditions the callers already handle.
    if (!aborted && (lastStatus >= 500 || lastStatus === 0)) {
      this.log(`request failed: ${String(lastErr)}`)
    }
    return undefined
  }

  // Health is served unprefixed at /health on both local and cloud.
  async health(): Promise<HealthResponse | undefined> {
    try {
      const res = await fetch(`${this.cfg.baseUrl}/health`)
      if (!res.ok) return undefined
      return (await res.json()) as HealthResponse
    } catch {
      return undefined
    }
  }

  // Cheap: writes a typed entry to the session cache, no graph build.
  async rememberEntry(entry: MemoryEntry, sessionId: string): Promise<RememberResult | undefined> {
    const body: RememberEntryRequest = {
      entry,
      dataset_name: this.cfg.dataset,
      session_id: sessionId,
    }
    return this.req<RememberResult>("POST", "/remember/entry", body)
  }

  // Session-first when session_id + scope:"auto"; falls back to the graph.
  async recall(req: Partial<RecallRequest> & { query: string }): Promise<RecallItem[]> {
    const base: RecallRequest = {
      query: req.query,
      session_id: req.session_id ?? null,
      scope: req.scope ?? "auto",
      search_type: req.search_type ?? null,
      datasets: req.datasets ?? [this.cfg.dataset],
      top_k: req.top_k ?? this.cfg.topK,
      only_context: req.only_context ?? false,
      include_references: req.include_references ?? false,
    }
    // Recall sits on the user's critical path (chat.message), so bound it
    // tightly and don't retry-with-backoff.
    const opts = { retries: 0, timeoutMs: this.cfg.recallTimeoutMs }
    let out = await this.req<RecallItem[]>("POST", "/recall", base, opts)

    // The "auto" scope needs a built graph and 404s on datasets that were never
    // cognified (common on Cognee Cloud, where the graph build may be disabled).
    // Fall back to the session cache so same-session memory still surfaces.
    if ((!out || out.length === 0) && req.session_id && base.scope !== "session") {
      out = await this.req<RecallItem[]>("POST", "/recall", { ...base, scope: "session" }, opts)
    }
    return Array.isArray(out) ? out : []
  }

  // Bridges cached session entries into the permanent graph (self-hosted only).
  // Cognee Cloud has no /improve endpoint and syncs sessions to the graph
  // server-side, so we probe once and then stop calling it. Best effort and
  // never noisy: bridging is not critical to capture or recall.
  async improve(sessionIds: string[]): Promise<void> {
    if (!this.bridgeSupported || sessionIds.length === 0) return
    await this.ensureAuth()
    const body: ImproveRequest = {
      dataset_name: this.cfg.dataset,
      session_ids: sessionIds,
      run_in_background: true,
    }
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), this.cfg.requestTimeoutMs)
    try {
      const res = await fetch(this.url("/improve"), {
        method: "POST",
        headers: this.authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
        signal: ac.signal,
      })
      if (res.status === 404) {
        this.bridgeSupported = false
        this.log("/improve not available (e.g. Cognee Cloud); session sync is handled server-side")
      }
    } catch {
      // best effort; bridging is non-critical
    } finally {
      clearTimeout(timer)
    }
  }

  async forget(req: ForgetRequest): Promise<void> {
    await this.req("POST", "/forget", req)
  }

  visualizeUrl(): string {
    return `${this.cfg.baseUrl}${this.cfg.apiPrefix}/schema/provenance?include_memory=true`
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
