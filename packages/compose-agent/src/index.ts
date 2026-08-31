/**
 * `@tanstack/compose-agent` — the agent layer, built entirely out of kernel
 * primitives. An **agent** is an ordinary **client**: the model provider, the
 * tool registry, the prompt registry, the session log and the loop are each
 * plugins, every **request** and **tool** call is an **action** other plugins
 * can wrap, and the **session** is the source of truth everything the model
 * sees is derived from.
 *
 * Terms are the ones in `CONTEXT.md`; the design is in `DESIGN.md` next to this
 * file, and the contract it meets is `docs/acceptance/agent.md`.
 */

export {
  agentKey,
  modelKey,
  promptKey,
  requestAction,
  sessionAppendedEvent,
  sessionKey,
  toolCallAction,
  toolsKey,
} from './keys'

export { deriveMessages, sessionPlugin } from './session'
export {
  createTool,
  toolMiddleware,
  toolsPlugin,
  toolsetPlugin,
  validateArgs,
} from './tools'
export { promptPlugin, promptSectionPlugin } from './prompt'
export { modelsPlugin } from './models'
export { loopPlugin } from './loop'
export { scriptedModelPlugin } from './scripted'
export type { ScriptedResponse } from './scripted'

export type {
  Agent,
  AgentStatus,
  AnyTool,
  ArgsOf,
  CloseReason,
  Message,
  ModelChunk,
  ModelProvider,
  ModelRegistry,
  ModelRequest,
  ModelResponse,
  PromptRegistry,
  PromptSection,
  ResultOfTool,
  SessionEntry,
  SessionEntryFields,
  SessionEntryInput,
  SessionLog,
  ToolCall,
  ToolCallInput,
  ToolConcurrency,
  ToolContext,
  ToolDefinition,
  ToolOutcome,
  ToolRegistry,
  ToolSchema,
} from './types'
