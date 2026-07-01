// OpenCode plugin host types (minimal subset), reproduced from @opencode-ai/plugin
// v1.17 so the adapter stays a zero-dependency, self-contained bundle. Verified
// against opencode/packages/plugin/src/index.ts and the SDK type gen. These live
// in the adapter, not the core, because they are specific to OpenCode.

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

// Plugin tool args use plain JSON Schema per arg. OpenCode's tool registry falls
// back to legacyJsonSchema() for non-zod args, so this keeps the bundle
// dependency-free while still giving the model a real schema.
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

export type ServerFn = (input: PluginInput, options?: Record<string, any>) => Promise<Hooks>

export interface PluginModule {
  id?: string
  server: ServerFn
}
