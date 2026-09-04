/**
 * `@tanstack/compose-agent` — the agent layer, built entirely out of kernel
 * primitives. An **agent** is an ordinary **client**: the model provider, the
 * tool registry, the prompt registry, the session log and the loop are each
 * plugins, every **request** and **tool** call is an **action** other plugins
 * can wrap, and the **session** is the source of truth everything the model
 * sees is derived from. The **composer** is one more plugin: it hands the model
 * tools for editing that plugin list, including writing plugins as **plugin
 * source**.
 *
 * Terms are the ones in `CONTEXT.md`; the design is in `DESIGN.md` next to this
 * file, and the contracts it meets are `docs/acceptance/agent.md` and
 * `docs/acceptance/self-modification.md`.
 */

export {
  credentialsKey,
  credentialsPlugin,
  environmentCredentials,
  staticCredentials,
} from './credentials'
export type {
  CredentialSource,
  Credentials,
  CredentialsOptionsInput,
} from './credentials'

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
export { composerPlugin } from './composer'
export { agentStubs, promptStub, toolsStub } from './stubs'
export {
  agentStub,
  createServerStub,
  createSlotsStub,
  grantView,
  pluginIdOf,
  serverStub,
  sessionStub,
  slotRegistryKey,
  slotsStub,
  viewIdOf,
  viewRendererKey,
  viewStubs,
  viewSuffix,
} from './views'
export { jsonSchemaValidator, schemaOf } from './json-schema'
export { optionsSchema } from './options'
export { loopPlugin } from './loop'
export { scriptedModelPlugin } from './scripted'
export type { ScriptedResponse } from './scripted'
export type {
  ComposerEntry,
  ComposerOptionsInput,
  ComposerResult,
} from './composer'
export type { WrittenSection, WrittenTool } from './stubs'
export type {
  Slot,
  SlotRegistry,
  ViewFill,
  ViewGrantConfig,
  ViewNode,
  ViewRenderer,
  ViewServerCall,
  ViewSessionEntry,
  ViewTone,
} from './views'
export type {
  DescribedValidator,
  JsonSchema,
  JsonSchemaType,
} from './json-schema'

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
  ToolCallOrigin,
  ToolConcurrency,
  ToolContext,
  ToolDefinition,
  ToolOutcome,
  ToolRegistry,
  ToolSchema,
} from './types'
