import type { QAEntry, TraceEntry } from "./types"
import { clip } from "./util"

// Build a TraceEntry from a tool.execute.after payload. Status is a heuristic:
// OpenCode does not flag tool errors explicitly in this hook, so we sniff the
// title/output for failure language.
export function traceFromTool(
  input: { tool: string; args: any },
  output: { title: string; output: string; metadata: any },
  captureOutput: boolean,
): TraceEntry {
  const blob = `${output?.title ?? ""} ${output?.output ?? ""}`
  const status: "success" | "error" = /\b(error|errored|failed|failure|exception|denied|not found|cannot|enoent)\b/i.test(
    blob,
  )
    ? "error"
    : "success"

  const params =
    input.args && typeof input.args === "object"
      ? Object.fromEntries(Object.entries(input.args).map(([k, v]) => [k, clip(v, 400)]))
      : { value: clip(input.args, 400) }

  return {
    type: "trace",
    origin_function: input.tool,
    status,
    method_params: params,
    method_return_value: captureOutput ? clip(output?.output, 2000) : undefined,
    memory_context: clip(output?.title ?? "", 200),
    error_message: status === "error" ? clip(output?.output, 400) : "",
  }
}

export function qaEntry(question: string, answer: string, context = ""): QAEntry {
  return {
    type: "qa",
    question: clip(question, 4000),
    answer: clip(answer, 8000),
    context: clip(context, 2000),
  }
}
