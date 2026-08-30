import { defineEvent, defineService } from '@tanstack/compose'
import { useComposition } from '@tanstack/react-compose'
import type { ReactNode } from 'react'

/**
 * A placeholder for the example this repo is aiming at: an agent whose own
 * composition — model adapter, tools, prompt sections, panels — is a list the
 * running UI can edit, with every change reconciled by id.
 *
 * Nothing here runs yet; the kernel is a scaffold. This module exists so the
 * example is wired to the workspace packages and type-checks against them.
 */

/** The seam an agent panel would read to render its tools. */
export const ToolsService = defineService<{
  list: () => ReadonlyArray<string>
}>('tools')

/** The waterfall a policy plugin would intercept to approve or veto a tool call. */
export const ToolCallEvent = defineEvent<[toolName: string], boolean>(
  'tool/call',
  { mode: 'waterfall' },
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
