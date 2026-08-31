import { createAction, createContextKey } from '@tanstack/compose'
import { useComposition } from '@tanstack/react-compose'
import type { ReactNode } from 'react'

/**
 * A placeholder for the example this repo is aiming at: an agent whose own
 * composition — model adapter, tools, prompt sections, panels — is a list the
 * running UI can edit, with every change reconciled by id.
 *
 * The kernel is built (roadmap slice 1); the React adapter this example renders
 * through is slice 2, so nothing runs yet. This module exists so the example is
 * wired to the workspace packages and type-checks against them.
 */

/** The context key an agent panel would read to render its tools. */
export const toolsKey = createContextKey<{
  list: () => ReadonlyArray<string>
}>('tools')

/** The action a policy plugin would wrap with middleware to veto a tool call. */
export const callToolAction = createAction<{ name: string }, string>(
  'tools.call',
)

function Composition(): ReactNode {
  const entries = useComposition()

  return (
    <ul>
      {entries.map((entry) => (
        <li key={entry.id}>
          {entry.id} — {entry.plugin}
          {entry.disabled ? ' (disabled)' : ''}
        </li>
      ))}
    </ul>
  )
}

export function App(): ReactNode {
  return (
    <main>
      <h1>Self-modifying agent</h1>
      <p>
        Scaffold. The kernel is not implemented yet, so the composition below
        renders nothing.
      </p>
      <Composition />
    </main>
  )
}
