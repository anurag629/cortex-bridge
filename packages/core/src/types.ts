// Cognee request/response types, mirroring the verified v1.2.x Pydantic models
// (cognee/memory/entries.py and the recall / improve / forget / cognify / memify
// routers). Runtime-agnostic: nothing here is tied to a specific agent host.

// Minimal identity an adapter passes so the core can derive a stable per-repo
// dataset name. Any host (OpenCode, Claude Code, an MCP agent) can supply these.
export interface WorkspaceIdentity {
  projectId?: string
  worktree?: string
  directory?: string
}

// ----------------------------------------------------------------------------
// Typed memory entries (POST /remember/entry)
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
