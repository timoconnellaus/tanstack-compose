import { createPlugin } from '@tanstack/compose'
import { Store } from '@tanstack/store'
import { sessionAppendedEvent, sessionKey } from './keys'
import { optionsSchema } from './options'
import type {
  Message,
  SessionEntry,
  SessionEntryInput,
  SessionLog,
  ToolOutcome,
} from './types'

/** How a tool outcome reaches the model: a string as-is, anything else as JSON. */
const outcomeContent = (outcome: ToolOutcome): string => {
  if (!outcome.ok) return outcome.error
  if (typeof outcome.value === 'string') return outcome.value
  if (outcome.value === undefined) return ''
  return JSON.stringify(outcome.value)
}

/**
 * Fold a session log into the messages one request sees. Pure and total, so
 * deriving twice from the same log gives the same messages, and a log replayed
 * into a fresh client derives the same messages (B2, B3).
 *
 * `chunk` entries are the streaming trace of the `assistant` entry that follows
 * them and are deliberately not derived; the `assistant` entry carries the
 * complete text.
 */
export function deriveMessages(
  entries: ReadonlyArray<SessionEntry>,
): Array<Message> {
  const messages: Array<Message> = []
  for (const entry of entries) {
    if (entry.kind === 'input') {
      messages.push({ role: 'user', content: entry.text })
    } else if (entry.kind === 'assistant') {
      messages.push({
        role: 'assistant',
        content: entry.text,
        toolCalls: entry.toolCalls,
      })
    } else if (entry.kind === 'tool-result') {
      messages.push({
        role: 'tool',
        callId: entry.callId,
        name: entry.name,
        content: outcomeContent(entry.outcome),
        isError: !entry.outcome.ok,
      })
    }
  }
  return messages
}

/** Entries a session may be forked or replayed from: the step and turn boundaries. */
const isBoundary = (entry: SessionEntry): boolean =>
  entry.kind === 'step-closed' || entry.kind === 'turn-closed'

const sessionOptions = optionsSchema<
  { entries?: ReadonlyArray<SessionEntry> } | undefined,
  { entries: Array<SessionEntry> }
>((value) => ({ entries: [...(value?.entries ?? [])] }))

/**
 * The session log: the source of truth for one conversation. Provides
 * {@link sessionKey}, emits {@link sessionAppendedEvent} for every append, and
 * can be seeded with entries to replay or fork a conversation (B3).
 *
 * @example
 * ```ts
 * { id: 'session', plugin: sessionPlugin, options: { entries: forked } }
 * ```
 */
export const sessionPlugin = createPlugin({
  name: 'session',
  provides: [sessionKey],
  validator: sessionOptions,
  setup(instance, options) {
    const entries = new Store<Array<SessionEntry>>(options.entries)
    let sequence = options.entries.length

    const log: SessionLog = {
      entries,
      append: (input: SessionEntryInput) => {
        sequence += 1
        const entry: SessionEntry = {
          ...input,
          id: `e${sequence}`,
          at: Date.now(),
        }
        entries.setState((previous) => [...previous, entry])
        instance.emit(sessionAppendedEvent, entry)
        return entry
      },
      snapshot: () => [...entries.state],
      messages: () => deriveMessages(entries.state),
      fork: (entryId: string) => {
        const at = entries.state.findIndex((entry) => entry.id === entryId)
        if (at === -1) {
          throw new Error(
            `@tanstack/compose-agent: no session entry "${entryId}" to fork at`,
          )
        }
        const entry = entries.state[at]!
        if (!isBoundary(entry)) {
          throw new Error(
            `@tanstack/compose-agent: session entry "${entryId}" is a "${entry.kind}", not a step or turn boundary`,
          )
        }
        return entries.state.slice(0, at + 1).map((each) => ({ ...each }))
      },
    }

    instance.provide(sessionKey, log)
  },
})
