/**
 * `@tanstack/react-compose` — the React adapter.
 *
 * Scaffold only. Every export below is a typed placeholder; see `ROADMAP.md`
 * (slice 2) for when it gets built and `CONTEXT.md` for the terms it has to use.
 */
import type { ReactNode } from 'react'
import type { Client, ContextKey } from '@tanstack/compose'

export interface ComposeProviderProps {
  client: Client
  children?: ReactNode
}

/** Puts a client on React context so hooks below it resolve against it. */
export function ComposeProvider(_props: ComposeProviderProps): ReactNode {
  // TODO: context provider; destroy the client when the provider unmounts.
  throw new Error(
    '@tanstack/react-compose: ComposeProvider is not implemented yet',
  )
}

/**
 * Read a context key from the nearest client, re-rendering when its provider is
 * swapped or goes away.
 */
export function useService<TValue>(_key: ContextKey<TValue>): TValue {
  // TODO: subscribe to the client's context store.
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
