import type { Part } from "./types"

// Reading an agent's transcript is host-specific, so it lives in the adapter,
// not the core. These parse OpenCode's chat parts and session.messages() shapes.

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
