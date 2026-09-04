import { createStub } from '@tanstack/compose'
import { viewStubs as uiViewStubs } from '@tanstack/react-compose/view-runtime'
import { agentKey, sessionKey } from './keys'
import type { AnyStubGrant, StubGrant } from '@tanstack/compose'
import type { AgentStatus } from './types'

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
  viewSuffix,
} from '@tanstack/react-compose/view-runtime'
export type {
  ViewFill,
  ViewGrantConfig,
  ViewNode,
  ViewRenderer,
  ViewServerCall,
  ViewSlot as Slot,
  ViewSlotRegistry as SlotRegistry,
  ViewTone,
} from '@tanstack/react-compose/view-runtime'

/** What the `session` view stub reads back: one entry as plain data. */
export interface ViewSessionEntry {
  id: string
  kind: string
  /** The text of an entry that has text: input, chunk, assistant, error. */
  text?: string
}

const agentDeclaration = `
/** Read what the agent is doing at the moment this is called. */
declare const agent: () => Promise<{ status: 'idle' | 'running' }>
`.trim()

const sessionDeclaration = `
/** One entry of the session, flattened to what a view can show. */
interface SessionEntryRead {
  id: string
  kind: string
  text?: string
}

/** Read entries from the end of the session. */
declare const session: (read?: {
  /** How many entries from the end. Defaults to 10. */
  last?: number
}) => Promise<Array<SessionEntryRead>>
`.trim()

/** The view stub that reads what the agent is doing now. */
export const agentStub: StubGrant<void, { status: AgentStatus }> = createStub<
  void,
  { status: AgentStatus }
>({
  name: 'agent',
  declarations: agentDeclaration,
  deps: [agentKey],
  handler: ({ instance }) => ({
    status: instance.context.get(agentKey).status.state,
  }),
})

/** The view stub that reads the end of the session. */
export const sessionStub: StubGrant<
  { last?: number } | undefined,
  Array<ViewSessionEntry>
> = createStub<{ last?: number } | undefined, Array<ViewSessionEntry>>({
  name: 'session',
  declarations: sessionDeclaration,
  deps: [sessionKey],
  handler: ({ input, instance }) => {
    const last = (input as { last?: number } | null | undefined)?.last ?? 10
    const entries = instance.context.get(sessionKey).snapshot()
    return entries.slice(Math.max(0, entries.length - last)).map((entry) => {
      const text = (entry as { text?: unknown; message?: unknown }).text
      const message = (entry as { message?: unknown }).message
      const shown = typeof text === 'string' ? text : message
      return {
        id: entry.id,
        kind: entry.kind,
        ...(typeof shown === 'string' ? { text: shown } : {}),
      }
    })
  },
})

/**
 * Compatibility grant set for agent-authored views: the general UI grants,
 * followed by the agent and session reads this package owns.
 */
export const viewStubs: ReadonlyArray<AnyStubGrant> = [
  ...uiViewStubs,
  agentStub,
  sessionStub,
]
