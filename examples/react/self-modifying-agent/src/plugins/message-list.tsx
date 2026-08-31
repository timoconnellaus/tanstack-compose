import { createPlugin } from '@tanstack/compose'
import { sessionKey } from '@tanstack/compose-agent'
import { Slot, slotsKey, useStore } from '@tanstack/react-compose'
import { chatMainSlot, chatMessageSlot } from '../slots'
import type { SessionEntry } from '@tanstack/compose-agent'
import type { ReactNode } from 'react'

/**
 * The default renderers, one per **session** entry kind this app shows. They are
 * ordinary **fills** of a **keyed** slot, so another plugin can replace any one
 * of them by filling the same key — latest wins — and the message list is none
 * the wiser. The renderer sees the slot's props type, so narrowing on `kind` is
 * all it takes to reach the fields of that kind (B3).
 */
const defaults: Record<string, (props: { entry: SessionEntry }) => ReactNode> =
  {
    input: ({ entry }) =>
      entry.kind === 'input' ? (
        <p className="message message-input">
          <span className="who">you</span>
          {entry.text}
        </p>
      ) : null,
    assistant: ({ entry }) =>
      entry.kind === 'assistant' && entry.text ? (
        <p className="message message-assistant">
          <span className="who">agent</span>
          {entry.text}
        </p>
      ) : null,
    'tool-call': ({ entry }) =>
      entry.kind === 'tool-call' ? (
        <p className="message message-tool">
          <span className="who">call</span>
          {entry.call.name}
          <code>{JSON.stringify(entry.call.args)}</code>
        </p>
      ) : null,
    'tool-result': ({ entry }) =>
      entry.kind === 'tool-result' ? (
        <p className="message message-tool">
          <span className="who">{entry.outcome.ok ? 'result' : 'failed'}</span>
          {entry.name}
          <code>
            {entry.outcome.ok
              ? JSON.stringify(entry.outcome.value)
              : entry.outcome.error}
          </code>
        </p>
      ) : null,
    // A **human step**: a person ran one of the agent's own tools. It reads the
    // same way a model's call does, because it is the same action.
    'human-tool-call': ({ entry }) =>
      entry.kind === 'human-tool-call' ? (
        <p className="message message-tool">
          <span className="who">you call</span>
          {entry.call.name}
          <code>{JSON.stringify(entry.call.args)}</code>
        </p>
      ) : null,
    'human-tool-result': ({ entry }) =>
      entry.kind === 'human-tool-result' ? (
        <p className="message message-tool">
          <span className="who">{entry.outcome.ok ? 'result' : 'failed'}</span>
          {entry.name}
          <code>
            {entry.outcome.ok
              ? JSON.stringify(entry.outcome.value)
              : entry.outcome.error}
          </code>
        </p>
      ) : null,
    error: ({ entry }) =>
      entry.kind === 'error' ? (
        <p className="message message-error">
          <span className="who">error</span>
          {entry.message}
        </p>
      ) : null,
  }

/**
 * The message list: it renders the session, entry by entry, through a **keyed**
 * slot it declares and fills with the default renderers. An entry of a kind
 * nothing fills renders nothing (A4), which is how the turn and step boundaries
 * stay out of the way.
 */
export const messageListPlugin = createPlugin({
  name: 'message-list',
  deps: [slotsKey, sessionKey],
  setup(instance) {
    const slots = instance.context.get(slotsKey)
    const session = instance.context.get(sessionKey)

    const MessageList = (): ReactNode => {
      const entries = useStore(session.entries)
      return (
        <ol className="messages" data-testid="messages">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Slot of={chatMessageSlot} props={{ entry }} />
            </li>
          ))}
        </ol>
      )
    }

    instance.cleanup(slots.declare(chatMessageSlot), 'slot(chat.message)')
    for (const [kind, render] of Object.entries(defaults)) {
      instance.cleanup(
        slots.fill(chatMessageSlot, { key: kind, render }),
        `fill(chat.message/${kind})`,
      )
    }
    instance.cleanup(
      slots.fill(chatMainSlot, { order: 0, render: MessageList }),
      'fill(chat.main)',
    )
  },
})
