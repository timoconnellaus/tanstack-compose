/** TanStack Start SSR, hydration and Durable Object support for Compose. */

export { ComposeStart, useComposeEdit, useComposeSnapshot } from './react'
export type { ComposeStartProps, ComposeTransport } from './react'

export { applySnapshot, serializeFills } from './snapshot'
export type {
  BrowserStatusReport,
  BrowserViewStatus,
  ComposeEdit,
  ComposeDispatch,
  ComposePress,
  ComposeSnapshot,
  ComposeValue,
  SerializedEntry,
  SerializedFill,
  SerializedPlugin,
  SnapshotEntry,
} from './snapshot'

export { createComposeDurableObject } from './durable-object'
export type {
  ComposeDurableObject,
  ComposeDurableObjectClass,
  ComposeDurableObjectOptions,
  StubCallProps,
} from './durable-object'
