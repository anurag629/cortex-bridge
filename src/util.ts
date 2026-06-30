// Small shared helpers. No external dependencies.

export function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function clip(v: unknown, max = 2000): string {
  let s = typeof v === "string" ? v : safeJson(v)
  if (s.length > max) s = s.slice(0, max) + " …[truncated]"
  return s
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "default"
  )
}

export function uid(prefix = "cognee"): string {
  const rnd = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)
  return `${prefix}-${rnd}`
}
