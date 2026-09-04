import { createPlugin } from '@tanstack/compose'
import { sessionKey } from '@tanstack/compose-agent'
import { Slot, slotsKey, useStore } from '@tanstack/react-compose'
import { useCallback, useEffect, useRef, useState } from 'react'
import { chatListTrailerSlot, chatMainSlot, chatMessageSlot } from '../slots'
import type { ReactNode } from 'react'
import type { ChatMessageProps, ToolResultEntry } from '../slots'

/**
 * Plain paragraphs for what the agent says. The markdown plugin fills the same
 * keys with a later fill and takes over; disable it and this is what renders.
 */
const AssistantText = ({ text }: { text: string }): ReactNode => (
  <div className="message message-assistant" data-testid="plain-text">
    <span className="who">agent</span>
    <div className="message-content">
      {text.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  </div>
)

const prettyJson = (value: unknown): string =>
  value === undefined ? 'undefined' : JSON.stringify(value, null, 2)

const objectValue = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const toolSummary = (
  args: unknown,
  result: ToolResultEntry | undefined,
): string | undefined => {
  if (result?.outcome.ok) {
    const value = result.outcome.value
    const entries = objectValue(value)?.entries
    if (Array.isArray(entries)) return `${entries.length} entries`
    if (Array.isArray(value)) return `${value.length} entries`
  }

  const values = objectValue(args)
  for (const key of ['id', 'name', 'plugin']) {
    if (typeof values?.[key] === 'string') return values[key]
  }
  return undefined
}

interface ToolActivityProps {
  id: string
  name: string
  args?: unknown
  result?: ToolResultEntry
  human: boolean
}

const ToolActivity = ({
  id,
  name,
  args,
  result,
  human,
}: ToolActivityProps): ReactNode => {
  const [expanded, setExpanded] = useState(false)
  const status = result ? (result.outcome.ok ? 'ok' : 'error') : 'running'
  const summary = toolSummary(args, result)
  const detailsId = `tool-details-${id}`
  return (
    <div
      className={`tool-row tool-row-${status}`}
      data-testid={`tool-call-${id}`}
    >
      <button
        type="button"
        className="tool-toggle"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="tool-icon" aria-hidden="true">
          ◇
        </span>
        {human ? <span className="tool-human">you</span> : null}
        <span className="tool-name">{name}</span>
        {summary ? <span className="tool-summary">· {summary}</span> : null}
        <span className={`tool-status tool-status-${status}`}>{status}</span>
        <span className="tool-chevron" aria-hidden="true">
          {expanded ? '▴' : '▾'}
        </span>
      </button>
      {expanded ? (
        <div className="tool-details" id={detailsId}>
          <div>
            <span>Arguments</span>
            <pre>
              <code>{prettyJson(args)}</code>
            </pre>
          </div>
          <div>
            <span>Result</span>
            <pre>
              <code>
                {result
                  ? prettyJson(
                      result.outcome.ok
                        ? result.outcome.value
                        : { error: result.outcome.error },
                    )
                  : 'Waiting for result…'}
              </code>
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const ResultActivity = ({ entry, paired }: ChatMessageProps): ReactNode => {
  if (
    paired ||
    (entry.kind !== 'tool-result' && entry.kind !== 'human-tool-result')
  ) {
    return null
  }
  return (
    <ToolActivity
      id={entry.callId}
      name={entry.name}
      result={entry}
      human={entry.kind === 'human-tool-result'}
    />
  )
}

/**
 * The default renderers, one per **session** entry kind this app shows. They are
 * ordinary **fills** of a **keyed** slot, so another plugin can replace any one
 * of them by filling the same key — latest wins — and the message list is none
 * the wiser. The renderer sees the slot's props type, so narrowing on `kind` is
 * all it takes to reach the fields of that kind (B3).
 */
const defaults: Record<string, (props: ChatMessageProps) => ReactNode> = {
  input: ({ entry }) =>
    entry.kind === 'input' ? (
      <div className="message message-input">
        <span className="who">you</span>
        <div className="message-content">
          <p>{entry.text}</p>
        </div>
      </div>
    ) : null,
  chunk: ({ streamedText }) =>
    streamedText ? <AssistantText text={streamedText} /> : null,
  assistant: ({ entry }) =>
    entry.kind === 'assistant' && entry.text ? (
      <AssistantText text={entry.text} />
    ) : null,
  'tool-call': ({ entry, result }) =>
    entry.kind === 'tool-call' ? (
      <ToolActivity
        id={entry.call.id}
        name={entry.call.name}
        args={entry.call.args}
        result={result}
        human={false}
      />
    ) : null,
  'tool-result': ResultActivity,
  // A **human step**: a person ran one of the agent's own tools. It reads the
  // same way a model's call does, because it is the same action.
  'human-tool-call': ({ entry, result }) =>
    entry.kind === 'human-tool-call' ? (
      <ToolActivity
        id={entry.call.id}
        name={entry.call.name}
        args={entry.call.args}
        result={result}
        human
      />
    ) : null,
  'human-tool-result': ResultActivity,
  error: ({ entry }) =>
    entry.kind === 'error' ? (
      <div className="message message-error">
        <span className="who">error</span>
        <div className="message-content">
          <p>{entry.message}</p>
        </div>
      </div>
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
      const list = useRef<HTMLOListElement>(null)
      const frame = useRef<number | undefined>(undefined)
      const [following, setFollowing] = useState(true)
      const scrollToLatest = useCallback(() => {
        if (frame.current !== undefined) return
        frame.current = requestAnimationFrame(() => {
          frame.current = undefined
          if (list.current) list.current.scrollTop = list.current.scrollHeight
        })
      }, [])

      useEffect(() => {
        if (following) scrollToLatest()
      }, [entries, following, scrollToLatest])

      useEffect(
        () => () => {
          if (frame.current !== undefined) cancelAnimationFrame(frame.current)
        },
        [],
      )

      const results = new Map<string, ToolResultEntry>()
      const calls = new Set<string>()
      const completedSteps = new Set<string>()
      for (const entry of entries) {
        if (entry.kind === 'tool-call' || entry.kind === 'human-tool-call') {
          calls.add(entry.call.id)
        } else if (
          entry.kind === 'tool-result' ||
          entry.kind === 'human-tool-result'
        ) {
          results.set(entry.callId, entry)
        } else if (entry.kind === 'assistant') {
          completedSteps.add(`${entry.turn}:${entry.step}`)
        }
      }
      const streamingText = new Map<string, string>()
      const chunks = new Map<string, { id: string; text: string }>()
      for (const entry of entries) {
        if (entry.kind !== 'chunk') continue
        const step = `${entry.turn}:${entry.step}`
        if (completedSteps.has(step)) continue
        const previous = chunks.get(step)?.text ?? ''
        chunks.set(step, { id: entry.id, text: previous + entry.text })
      }
      for (const chunk of chunks.values()) {
        streamingText.set(chunk.id, chunk.text)
      }
      return (
        <div className="messages-frame">
          <ol
            ref={list}
            className="messages"
            data-testid="messages"
            onScroll={(event) => {
              const element = event.currentTarget
              const nearBottom =
                element.scrollHeight -
                  element.clientHeight -
                  element.scrollTop <=
                64
              if (!nearBottom && frame.current !== undefined) {
                cancelAnimationFrame(frame.current)
                frame.current = undefined
              }
              setFollowing(nearBottom)
            }}
          >
            {entries.map((entry) => {
              const callId =
                entry.kind === 'tool-call' || entry.kind === 'human-tool-call'
                  ? entry.call.id
                  : undefined
              const resultId =
                entry.kind === 'tool-result' ||
                entry.kind === 'human-tool-result'
                  ? entry.callId
                  : undefined
              return (
                <li key={entry.id}>
                  <Slot
                    of={chatMessageSlot}
                    props={{
                      entry,
                      result: callId ? results.get(callId) : undefined,
                      paired: resultId ? calls.has(resultId) : false,
                      streamedText: streamingText.get(entry.id),
                    }}
                  />
                </li>
              )
            })}
            <Slot
              of={chatListTrailerSlot}
              props={{ streaming: streamingText.size > 0 }}
            />
          </ol>
          {!following ? (
            <button
              type="button"
              className="jump-latest"
              onClick={() => {
                setFollowing(true)
                scrollToLatest()
              }}
            >
              Jump to latest
            </button>
          ) : null}
        </div>
      )
    }

    instance.cleanup(slots.declare(chatMessageSlot), 'slot(chat.message)')
    instance.cleanup(
      slots.declare(chatListTrailerSlot),
      'slot(chat.list.trailer)',
    )
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
