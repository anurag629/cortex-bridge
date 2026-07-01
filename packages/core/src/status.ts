import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

// Writes a small, human-readable snapshot of what the plugin is doing to
// ~/.config/opencode/cognee-status.json. OpenCode does not surface plugin
// console output, so this file is the way to verify the plugin is connected,
// which server/dataset it is using, and whether captures are flowing.
const STATUS_PATH = join(homedir(), ".config", "opencode", "cognee-status.json")

export class Status {
  private data: Record<string, any>

  constructor(initial: Record<string, any>) {
    this.data = { captures: 0, recalls: 0, bridges: 0, errors: 0, ...initial }
    this.flush()
  }

  set(patch: Record<string, any>): void {
    Object.assign(this.data, patch)
    this.flush()
  }

  bump(key: "captures" | "recalls" | "bridges" | "errors", patch?: Record<string, any>): void {
    this.data[key] = (this.data[key] ?? 0) + 1
    if (patch) Object.assign(this.data, patch)
    this.flush()
  }

  private flush(): void {
    try {
      mkdirSync(dirname(STATUS_PATH), { recursive: true })
      writeFileSync(
        STATUS_PATH,
        JSON.stringify({ ...this.data, updatedAt: new Date().toISOString() }, null, 2),
      )
    } catch {
      // best effort; never throw from the status writer
    }
  }
}

export const STATUS_FILE = STATUS_PATH
