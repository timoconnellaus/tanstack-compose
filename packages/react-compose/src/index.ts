/**
 * `@tanstack/react-compose` — the React **adapter**, and the **slot** registry
 * every adapter would share.
 *
 * It exposes a **client** to React through a provider, a hook per client store,
 * a hook that reads a **context key**, a `Slot` component, and the renderer
 * that turns a **view**'s declarative tree into a **fill**. It knows nothing
 * about agents, chat, or anything a plugin might do with a slot (B1).
 *
 * Terms are the ones in `CONTEXT.md`; the design is in `DESIGN.md` next to this
 * file, and the contract it meets is `docs/acceptance/ui.md` §A and §B.
 */

export {
  ComposeProvider,
  isClient,
  useClient,
  useClientErrors,
  useComposeView,
  useContextKey,
  useInstances,
  usePluginList,
} from './client'
export type {
  ComposeProviderProps,
  ComposeView,
  ComposeViewEntry,
  ComposeViewStore,
  UseContextKeyOptions,
} from './client'

export {
  createSlot,
  createSlotRegistry,
  resolveFills,
  Slot,
  slotsKey,
  slotsPlugin,
  useFills,
} from './slots'
export type {
  AnySlot,
  Fill,
  FillInput,
  PropsOf,
  SlotCardinality,
  SlotComponentProps,
  SlotRegistry,
  SlotsState,
} from './slots'

export { createViewRenderer, viewsPlugin } from './views'
export {
  createServerStub,
  createSlotsStub,
  grantView,
  pluginIdOf,
  serverStub,
  slotRegistryKey,
  slotsStub,
  viewIdOf,
  viewRendererKey,
  viewStubs,
  viewSuffix,
} from './view-runtime'
export type {
  ViewCallback,
  ViewFill,
  ViewGrantConfig,
  ViewNode,
  ViewRenderer,
  ViewServerCall,
  ViewSlot,
  ViewSlotRegistry,
  ViewTone,
} from './view-runtime'

export { useStore } from '@tanstack/react-store'
