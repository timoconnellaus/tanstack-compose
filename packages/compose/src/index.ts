/**
 * `@tanstack/compose` — the framework-agnostic kernel: the client, plugins,
 * context and deps, cleanup, status, options, middleware and events, and
 * plugin-list reconciliation.
 *
 * Terms are the ones in `CONTEXT.md`; the design is in `DESIGN.md` next to this
 * file, and the contract it meets is `docs/acceptance/kernel.md`.
 */

export { createClient, optionsUpdateAction, reconcileAction } from './client'
export {
  createAction,
  createContextKey,
  createEvent,
  definePlugin,
} from './definitions'

export type {
  ActionDefinition,
  ActionHandler,
  AnyAction,
  AnyContextKey,
  AnyEvent,
  AnyPlugin,
  Cleanup,
  Client,
  ClientErrorReport,
  ContextKey,
  ContextSnapshot,
  ContextView,
  EventDefinition,
  InputOf,
  Instance,
  InstanceSnapshot,
  Listener,
  Middleware,
  OptionsInputOf,
  Plugin,
  PluginEntry,
  ResourceNode,
  ResultOf,
  Status,
  ValueOf,
} from './definitions'

export type {
  InferInput,
  InferOutput,
  StandardSchemaIssue,
  StandardSchemaResult,
  StandardSchemaV1,
} from './standard-schema'
