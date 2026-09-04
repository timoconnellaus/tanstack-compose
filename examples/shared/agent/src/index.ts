/**
 * Example-local agent runtime, built entirely out of kernel
 * primitives. An **agent** is an ordinary **client**: the model provider, the
 * tool registry, the prompt registry, the session log and the loop are each
 * plugins, every **request** and **tool** call is an **action** other plugins
 * can wrap, and the **session** is the source of truth everything the model
 * sees is derived from. The **composer** is one more plugin: it hands the model
 * tools for editing that plugin list, including writing plugins as **plugin
 * source**.
 *
 * Terms are the ones in `CONTEXT.md`; the deployed assembly records its choices
 * in `examples/start/agent/DESIGN.md`, and the contracts are
 * `docs/acceptance/agent.md` and `docs/acceptance/self-modification.md`.
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

export { createSessionPlugin, deriveMessages, sessionPlugin } from './session'
export type { SessionPersistence } from './session'
export {
  createTool,
  toolMiddleware,
  toolsPlugin,
  toolsetPlugin,
  validateArgs,
} from './tools'
export { promptPlugin, promptSectionPlugin } from './prompt'
export { modelsPlugin } from './models'
export { composerPlugin, createComposerPlugin } from './composer'
export type { ComposerPluginOptions } from './composer'
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
export {
  jsonSchemaValidator,
  optionsSchema,
  schemaOf,
} from '@tanstack/compose-tools'
export { loopPlugin } from './loop'
export { createScriptedModelPlugin, scriptedModelPlugin } from './scripted'
export type { ScriptedResponse } from './scripted'
export { openaiModelPlugin } from './openai'
export type { OpenAiOptions } from './openai'
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
} from '@tanstack/compose-tools'
export type { ComposerEntry, ComposerResult } from '@tanstack/compose-tools'

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
