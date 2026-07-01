// Type definitions for both sides of the bridge.
//
// OpenCode plugin host types are reproduced here (minimal subset) from
// @opencode-ai/plugin v1.17 so the plugin stays a zero-dependency, fully
// self-contained bundle. Verified against:
//   opencode/packages/plugin/src/index.ts
//   opencode/packages/sdk/js/src/gen/types.gen.ts
//
// Cognee request/response types mirror the verified v1.2.1 Pydantic models:
//   cognee/cognee/memory/entries.py and the recall/improve/forget routers.

// ----------------------------------------------------------------------------
// OpenCode plugin host (minimal)
// ----------------------------------------------------------------------------

export interface OpencodeProject {
  id: string
  worktree: string
  vcs?: string
  time?: { created: number; initialized?: number }
}

export interface PluginInput {
  client: any
  project: OpencodeProject
  directory: string
  worktree: string
  serverUrl?: URL
  $?: any
}

export interface Part {
  id?: string
  type: string
  text?: string
  synthetic?: boolean
  messageID?: string
  sessionID?: string
  [k: string]: any
}

export interface ToolContext {
  sessionID: string
  messageID: string
  agent: string
  directory: string
  worktree: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: Record<string, any> }): void
  ask(input: any): Promise<void>
}

export type ToolResult =
  | string
  | { title?: string; output: string; metadata?: Record<string, any> }

// Plugin tool args use plain JSON Schema per arg. OpenCode's tool registry
// falls back to legacyJsonSchema() for non-zod args (registry.ts), so this
// keeps the bundle dependency-free while still giving the model a real schema.
export interface ToolDefinition {
  description: string
  args: Record<string, unknown>
  execute(args: any, context: ToolContext): Promise<ToolResult>
}

export interface BusEvent {
  id?: string
  type: string
  properties?: any
}

export interface ChatMessageInput {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  messageID?: string
  variant?: string
}

export interface Hooks {
  event?: (input: { event: BusEvent }) => Promise<void>
  "chat.message"?: (
    input: ChatMessageInput,
    output: { message: any; parts: Part[] },
  ) => Promise<void>
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any },
  ) => Promise<void>
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>
  dispose?: () => Promise<void> | void
  tool?: Record<string, ToolDefinition>
}

export type ServerFn = (
  input: PluginInput,
  options?: Record<string, any>,
) => Promise<Hooks>

export interface PluginModule {
  id?: string
  server: ServerFn
}

// ----------------------------------------------------------------------------
// Cognee typed memory entries (POST /remember/entry)
// ----------------------------------------------------------------------------

export interface TraceEntry {
  type: "trace"
  origin_function: string
  status: "success" | "error"
  method_params?: Record<string, any> | null
  method_return_value?: any
  memory_query?: string
  memory_context?: string
  error_message?: string
  generate_feedback_with_llm?: boolean
}

export interface QAEntry {
  type: "qa"
  question: string
  answer: string
  context?: string
  feedback_text?: string | null
  feedback_score?: number | null
  used_graph_element_ids?: Record<string, any> | null
}

export interface FeedbackEntry {
  type: "feedback"
  qa_id: string
  feedback_text?: string | null
  feedback_score?: number | null
}

export type MemoryEntry = TraceEntry | QAEntry | FeedbackEntry

export interface RememberEntryRequest {
  entry: MemoryEntry
  dataset_name: string
  session_id?: string | null
  skill_improvement?: Record<string, any> | null
}

export interface RememberResult {
  status: string
  dataset_name?: string
  dataset_id?: string
  session_ids?: string[]
  entry_type?: string
  entry_id?: string
  elapsed_seconds?: number
  error?: string
}

// ----------------------------------------------------------------------------
// Recall / improve / forget
// ----------------------------------------------------------------------------

export interface RecallRequest {
  query: string
  session_id?: string | null
  scope?: string | string[] | null
  search_type?: string | null
  datasets?: string[] | null
  dataset_ids?: string[] | null
  top_k?: number
  only_context?: boolean
  include_references?: boolean
  system_prompt?: string
}

export interface RecallItem {
  source?: "session" | "trace" | "graph" | "graph_context" | string
  content?: string
  question?: string
  answer?: string
  context?: string
  score?: number
  qa_id?: string
  origin_function?: string
  long_description?: string
  short_description?: string
  name?: string
  [k: string]: any
}

export interface ImproveRequest {
  dataset_name?: string | null
  dataset_id?: string | null
  session_ids?: string[] | null
  run_in_background?: boolean
  build_global_context_index?: boolean
}

export interface ForgetRequest {
  data_id?: string | null
  dataset?: string | null
  dataset_id?: string | null
  everything?: boolean
  memory_only?: boolean
}

// cognify / memify use camelCase fields (the classic-pipeline endpoints),
// unlike the snake_case memory endpoints above.
export interface CognifyRequest {
  datasets?: string[] | null
  datasetIds?: string[] | null
  runInBackground?: boolean
}

export interface MemifyRequest {
  datasetName?: string | null
  datasetId?: string | null
  nodeName?: string[] | null
  extractionTasks?: string[] | null
  enrichmentTasks?: string[] | null
  runInBackground?: boolean
}

export interface HealthResponse {
  status: string
  health?: string
  version?: string
}
