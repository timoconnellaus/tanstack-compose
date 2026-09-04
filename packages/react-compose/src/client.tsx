import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from 'react'
import type {
  ActionDefinition,
  Client,
  ClientErrorReport,
  ContextKey,
  ContextSnapshot,
  InstanceSnapshot,
} from '@tanstack/compose'
import type { ReactNode } from 'react'

/** The plugin-entry fields a read-only UI can rely on. */
export interface ComposeViewEntry {
  /** Stable identity of this plugin-list row. */
  id: string
  /** Options shown by read-only tooling, when present. */
  options?: unknown
  /** `false` means the entry is disabled. */
  enabled?: boolean
}

/** The observable part of a store exposed through a {@link ComposeView}. */
export interface ComposeViewStore<T> {
  /** The store's current value. */
  readonly state: T
  /** Observe changes; call `unsubscribe` to stop observing. */
  subscribe: (onChange: () => void) => { unsubscribe: () => void }
}

/**
 * The read-only surface React components need from a **client** or follower.
 * A real {@link Client} satisfies this interface structurally.
 */
export interface ComposeView {
  readonly pluginList: ComposeViewStore<ReadonlyArray<ComposeViewEntry>>
  readonly instances: ComposeViewStore<ReadonlyArray<InstanceSnapshot>>
  readonly context: ComposeViewStore<ReadonlyArray<ContextSnapshot>>
  readonly errors: ComposeViewStore<ReadonlyArray<ClientErrorReport>>
  /** Read a context key from outside a plugin. */
  getContext: <TValue>(key: ContextKey<TValue>) => TValue | undefined
  /** List every instance with its status and unmet deps. */
  inspect: () => Array<InstanceSnapshot>
  /** Run an action when the view's adapter offers that transport. */
  dispatch?: <TInput, TResult>(
    action: ActionDefinition<TInput, TResult>,
    input: TInput,
  ) => Promise<TResult>
  /** Call a source handler when the view's adapter offers that transport. */
  callSource?: (id: string, name: string, input?: unknown) => Promise<unknown>
}

const ComposeViewContext = createContext<ComposeView | undefined>(undefined)

/** What {@link ComposeProvider} takes. */
export interface ComposeProviderProps {
  /** The **client** view everything below reads through. */
  client: ComposeView
  children?: ReactNode
}

/**
 * Puts a **client** view on React context so the hooks below resolve against it.
 *
 * The client's lifetime is the caller's: the provider neither creates nor
 * destroys it, so a re-mount (React strict mode, a route change) never restarts
 * the application.
 *
 * @example
 * ```tsx
 * <ComposeProvider client={client}>
 *   <Slot of={rootSlot} />
 * </ComposeProvider>
 * ```
 */
export function ComposeProvider({
  client,
  children,
}: ComposeProviderProps): ReactNode {
  return (
    <ComposeViewContext.Provider value={client}>
      {children}
    </ComposeViewContext.Provider>
  )
}

/** The nearest read-only **client** view. */
export function useComposeView(): ComposeView {
  const view = useContext(ComposeViewContext)
  if (!view) {
    throw new Error(
      '@tanstack/react-compose: no ComposeProvider above this component',
    )
  }
  return view
}

/** Whether a view is a mutating {@link Client}, checked structurally. */
export function isClient(view: ComposeView): view is Client {
  return typeof (view as Partial<Client>).setPluginList === 'function'
}

/**
 * The nearest mutating **client**. Throws when the provider holds only a
 * read-only {@link ComposeView}.
 */
export function useClient(): Client {
  const view = useComposeView()
  if (!isClient(view)) {
    throw new Error(
      '@tanstack/react-compose: useClient() requires a Client; the ComposeProvider contains a read-only ComposeView',
    )
  }
  return view
}

/** How {@link useContextKey} behaves while the key is not provided. */
export interface UseContextKeyOptions {
  /** `true` suspends until a plugin provides the key instead of returning `undefined`. */
  suspend?: boolean
}

/**
 * Read a **context key** from the nearest client, re-rendering when the key is
 * provided or withdrawn (B2). Observation is the client's context store, so a
 * provider swapped by a plugin-list edit reaches the UI with nothing restarting.
 *
 * @example
 * ```tsx
 * const agent = useContextKey(agentKey) // Agent | undefined
 * const slots = useContextKey(slotsKey, { suspend: true }) // SlotRegistry
 * ```
 */
export function useContextKey<TValue>(
  key: ContextKey<TValue>,
  options: { suspend: true },
): TValue
export function useContextKey<TValue>(
  key: ContextKey<TValue>,
  options?: UseContextKeyOptions,
): TValue | undefined
export function useContextKey<TValue>(
  key: ContextKey<TValue>,
  options?: UseContextKeyOptions,
): TValue | undefined {
  const view = useComposeView()
  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = view.context.subscribe(onChange)
      return () => subscription.unsubscribe()
    },
    [view],
  )
  const read = useCallback(() => view.getContext(key), [key, view])
  const value = useSyncExternalStore(subscribe, read, read)
  if (value === undefined && options?.suspend) {
    throw new Promise<void>((resolve) => {
      const subscription = view.context.subscribe(() => {
        if (view.getContext(key) !== undefined) {
          subscription.unsubscribe()
          resolve()
        }
      })
    })
  }
  return value
}

const useViewStore = <T,>(store: ComposeViewStore<T>): T => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = store.subscribe(onChange)
      return () => subscription.unsubscribe()
    },
    [store],
  )
  const read = useCallback(() => store.state, [store])
  return useSyncExternalStore(subscribe, read, read)
}

/** The **plugin list** of the nearest view, re-read on every edit. */
export function usePluginList(): ReadonlyArray<ComposeViewEntry> {
  return useViewStore(useComposeView().pluginList)
}

/** Every **plugin instance** with its **status** and unmet **deps**. */
export function useInstances(): ReadonlyArray<InstanceSnapshot> {
  return useViewStore(useComposeView().instances)
}

/** The failures the client contained rather than propagated. */
export function useClientErrors(): ReadonlyArray<ClientErrorReport> {
  return useViewStore(useComposeView().errors)
}
