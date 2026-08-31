import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from 'react'
import { useStore } from '@tanstack/react-store'
import type {
  Client,
  ClientErrorReport,
  ContextKey,
  InstanceSnapshot,
  PluginEntry,
} from '@tanstack/compose'
import type { ReactNode } from 'react'

const ClientContext = createContext<Client | undefined>(undefined)

/** What {@link ComposeProvider} takes. */
export interface ComposeProviderProps {
  /** The **client** everything below reads through. */
  client: Client
  children?: ReactNode
}

/**
 * Puts a **client** on React context so the hooks below it resolve against it.
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
    <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
  )
}

/** The nearest **client**. Throws when there is no {@link ComposeProvider} above. */
export function useClient(): Client {
  const client = useContext(ClientContext)
  if (!client) {
    throw new Error(
      '@tanstack/react-compose: no ComposeProvider above this component',
    )
  }
  return client
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
  const client = useClient()
  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = client.context.subscribe(onChange)
      return () => subscription.unsubscribe()
    },
    [client],
  )
  const read = useCallback(() => client.getContext(key), [client, key])
  const value = useSyncExternalStore(subscribe, read, read)
  if (value === undefined && options?.suspend) {
    throw new Promise<void>((resolve) => {
      const subscription = client.context.subscribe(() => {
        if (client.getContext(key) !== undefined) {
          subscription.unsubscribe()
          resolve()
        }
      })
    })
  }
  return value
}

/** The **plugin list** of the nearest client, re-read on every edit. */
export function usePluginList(): Array<PluginEntry> {
  return useStore(useClient().pluginList)
}

/** Every **plugin instance** with its **status** and unmet **deps**. */
export function useInstances(): Array<InstanceSnapshot> {
  return useStore(useClient().instances)
}

/** The failures the client contained rather than propagated. */
export function useClientErrors(): Array<ClientErrorReport> {
  return useStore(useClient().errors)
}
