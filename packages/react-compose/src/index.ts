/**
 * `@tanstack/react-compose` — the React **adapter**, and the **slot** registry
 * every adapter would share.
 *
 * It exposes a **client** to React through a provider, a hook per client store,
 * a hook that reads a **context key**, and a `Slot` component. It knows nothing
 * about agents, chat, or anything a plugin might do with a slot (B1).
 *
 * Terms are the ones in `CONTEXT.md`; the design is in `DESIGN.md` next to this
 * file, and the contract it meets is `docs/acceptance/ui.md` §A and §B.
 */

export {
  ComposeProvider,
  useClient,
  useClientErrors,
  useContextKey,
  useInstances,
  usePluginList,
} from './client'
export type { ComposeProviderProps, UseContextKeyOptions } from './client'

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

export { useStore } from '@tanstack/react-store'
