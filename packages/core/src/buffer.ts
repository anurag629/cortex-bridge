import type { CogneeClient } from "./client"

type Logger = (msg: string, ...args: any[]) => void

interface SessionState {
  openQuestion?: string
  openMessageID?: string
  lastBridge: number
  dirty: boolean // has entries captured to cache but not yet bridged
  bridgeTimer?: ReturnType<typeof setTimeout>
}

// Tracks per-host-session local state (the open Q&A, dirty flag, debounce) and
// hands out the SHARED Cognee session id so every agent on this dataset reads
// and writes one session cache. That is what makes capture in one tool recall
// in another, without waiting on a graph build. Bridging (improve) is debounced
// on idle and forced on compaction / dispose.
export class SessionBuffer {
  private sessions = new Map<string, SessionState>()

  constructor(
    private client: CogneeClient,
    private debounceMs: number,
    private log: Logger,
    private sharedSessionId: string,
  ) {}

  private get(sessionID: string): SessionState {
    let s = this.sessions.get(sessionID)
    if (!s) {
      s = { lastBridge: 0, dirty: false }
      this.sessions.set(sessionID, s)
    }
    return s
  }

  // The Cognee session id is shared per dataset (repo), not per host session, so
  // memory crosses agents and sessions through one cache.
  cogneeSessionId(_sessionID?: string): string {
    return this.sharedSessionId
  }

  markDirty(sessionID: string): void {
    this.get(sessionID).dirty = true
  }

  openQA(sessionID: string, question: string, messageID?: string): void {
    const s = this.get(sessionID)
    s.openQuestion = question
    s.openMessageID = messageID
  }

  takeOpenQuestion(sessionID: string): { question?: string; messageID?: string } {
    const s = this.get(sessionID)
    const out = { question: s.openQuestion, messageID: s.openMessageID }
    s.openQuestion = undefined
    s.openMessageID = undefined
    return out
  }

  scheduleBridge(sessionID: string): void {
    const s = this.get(sessionID)
    if (!s.dirty || s.bridgeTimer) return
    const wait = Math.max(0, this.debounceMs - (Date.now() - s.lastBridge))
    s.bridgeTimer = setTimeout(() => {
      s.bridgeTimer = undefined
      void this.bridge(sessionID)
    }, wait)
    // Don't keep the process alive just for a pending bridge.
    if (typeof s.bridgeTimer?.unref === "function") s.bridgeTimer.unref()
  }

  async bridge(sessionID: string, force = false): Promise<void> {
    const s = this.get(sessionID)
    if (s.bridgeTimer) {
      clearTimeout(s.bridgeTimer)
      s.bridgeTimer = undefined
    }
    if (!s.dirty && !force) return
    s.dirty = false
    s.lastBridge = Date.now()
    this.log(`bridging ${this.sharedSessionId} into graph`)
    await this.client.improve([this.sharedSessionId])
  }

  async flushAll(): Promise<void> {
    for (const id of this.sessions.keys()) await this.bridge(id, false)
  }
}
