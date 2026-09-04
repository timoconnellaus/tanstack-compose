import { createSlot } from '@tanstack/react-compose'
import type { SessionEntry } from '@tanstack/compose-agent'

/** A tool outcome entry paired with the call that produced it. */
export type ToolResultEntry = Extract<
  SessionEntry,
  { kind: 'tool-result' | 'human-tool-result' }
>

/** Display data the message list supplies to a keyed message fill. */
export interface ChatMessageProps {
  entry: SessionEntry
  result?: ToolResultEntry
  paired?: boolean
  streamedText?: string
}

/**
 * Every **slot** this app has. They are values, like **context keys**, so a
 * plugin that fills one imports it and nothing is declared globally.
 *
 * The plugin that renders a slot is the one that declares it; the names here are
 * also what a written **view** would name to fill the same places.
 */

/** The whole page. The page frame fills it; nothing else does. */
export const rootSlot = createSlot('root')

/** The conversation column: the message list, then the input box. */
export const chatMainSlot = createSlot('chat.main')

/** The side column: the plugin panel, the model picker, the action log. */
export const chatSideSlot = createSlot('chat.side')

/**
 * One **session** entry, keyed by its kind, so a plugin can replace how any one
 * kind of entry reads without the message list knowing.
 */
export const chatMessageSlot = createSlot<ChatMessageProps>('chat.message', {
  cardinality: 'keyed',
  key: (props) => props.entry.kind,
})

/** The buttons beside the input box. The stop button is one of them. */
export const chatInputActionsSlot = createSlot<{ draft: string }>(
  'chat.input.actions',
)
