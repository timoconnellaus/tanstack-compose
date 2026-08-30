/**
 * `@tanstack/react-compose` — the React adapter.
 *
 * Scaffold only. Every export below is a typed placeholder; see `INTENT.md` at the
 * repository root for the invariants the real implementation has to satisfy.
 */
import type { ReactNode } from 'react'
import type { Runtime, ServiceToken } from '@tanstack/compose'

export interface ComposeProviderProps {
  runtime: Runtime
  children?: ReactNode
}

/** Puts a runtime on React context so hooks below it resolve against that scope. */
export function ComposeProvider(_props: ComposeProviderProps): ReactNode {
  // TODO: context provider; dispose the runtime when the provider unmounts.
  throw new Error(
    '@tanstack/react-compose: ComposeProvider is not implemented yet',
  )
}

/**
 * Read a service from the nearest runtime, re-rendering when its provider is
 * swapped or goes away.
 */
export function useService<TValue>(_token: ServiceToken<TValue>): TValue {
  // TODO: subscribe to the service registry store.
  throw new Error('@tanstack/react-compose: useService is not implemented yet')
}

/** A live view of one entry in the composition tree. */
export interface CompositionEntry {
  id: string
  plugin: string
  disabled?: boolean
}

/** Read (and eventually edit) the live composition tree. */
export function useComposition(): ReadonlyArray<CompositionEntry> {
  // TODO: subscribe to the composition store.
  throw new Error(
    '@tanstack/react-compose: useComposition is not implemented yet',
  )
}
