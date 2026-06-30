import type { Part, RecallItem } from "./types"
import { clip } from "./util"

// Pull the user's text out of the resolved chat.message parts (ignore the
// synthetic memory we inject ourselves).
export function extractUserText(parts: Part[]): string {
  return (parts ?? [])
    .filter((p) => p?.type === "text" && !p.synthetic && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n")
    .trim()
}

// Pull the assistant's reply text from a session.messages() response:
// Array<{ info: { role }, parts: Part[] }>.
export function extractAssistantText(messages: any[]): string {
  const assistant = [...(messages ?? [])].reverse().find((m) => m?.info?.role === "assistant")
  if (!assistant) return ""
  return (assistant.parts ?? [])
    .filter((p: any) => p?.type === "text" && typeof p.text === "string")
    .map((p: any) => p.text as string)
    .join("\n")
    .trim()
}

// Render recall results as compact markdown for injection / tool output.
export function formatRecall(items: RecallItem[]): string {
  if (!items?.length) return ""
  const lines: string[] = []
  for (const it of items) {
    if (it.source === "session" && (it.question || it.answer)) {
      const tag = it.qa_id ? `  (qa_id: ${it.qa_id})` : ""
      lines.push(`- Q: ${clip(it.question ?? "", 200)}\n  A: ${clip(it.answer ?? "", 400)}${tag}`)
    } else if (it.source === "trace") {
      const fn = it.origin_function ?? it.content ?? ""
      if (fn) lines.push(`- past action: ${clip(fn, 300)}`)
    } else {
      // graph / graph_context / other: only keep items with real content,
      // so an empty graph_completion never injects a useless bullet.
      const c =
        it.content ??
        it.text ??
        it.long_description ??
        it.short_description ??
        it.answer ??
        it.name
      if (typeof c === "string" && c.trim()) lines.push(`- ${clip(c, 400)}`)
    }
  }
  return lines.join("\n")
}
