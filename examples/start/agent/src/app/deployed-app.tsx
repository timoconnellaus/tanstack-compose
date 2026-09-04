import { ComposeStart, useComposeSnapshot } from '@tanstack/start-compose'
import { Slot, useComposeView } from '@tanstack/react-compose'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { dispatchCompose, pressCompose } from '../compose-functions'
import {
  cancelAction,
  chatInputActionsSlot,
  chatMainSlot,
  chatSideSlot,
  sendAction,
} from '../base'
import type { SessionEntry } from '@tanstack/compose-example-agent-runtime'
import type { ComposeSnapshot, ComposeTransport } from '@tanstack/start-compose'
import type { KeyboardEvent, ReactNode } from 'react'

interface AgentSnapshotState {
  session: Array<SessionEntry>
  status: 'idle' | 'running'
}

const stateOf = (snapshot: ComposeSnapshot): AgentSnapshotState =>
  snapshot.state as unknown as AgentSnapshotState

const pluginEntry = (snapshot: ComposeSnapshot, id: string) =>
  snapshot.pluginList.find((entry) => entry.id === id)

const active = (snapshot: ComposeSnapshot, id: string): boolean => {
  const entry = pluginEntry(snapshot, id)
  return entry !== undefined && entry.enabled !== false
}

const assistantText = (
  text: string,
  markdown: boolean,
  streaming = false,
): ReactNode => (
  <article
    className={`message assistant${streaming ? ' streaming' : ''}`}
    data-testid={markdown ? 'markdown' : 'plain-text'}
  >
    <span className="who">agent</span>
    <div>
      {markdown ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
          {text}
        </ReactMarkdown>
      ) : (
        text
          .split(/\n{2,}/)
          .map((paragraph, index) => <p key={index}>{paragraph}</p>)
      )}
    </div>
  </article>
)

const pretty = (value: unknown): string =>
  value === undefined ? '' : JSON.stringify(value, null, 2)

const isStreaming = (entries: ReadonlyArray<SessionEntry>): boolean => {
  const complete = new Set(
    entries.flatMap((entry) =>
      entry.kind === 'assistant' ? [`${entry.turn}:${entry.step}`] : [],
    ),
  )
  return entries.some(
    (entry) =>
      entry.kind === 'chunk' && !complete.has(`${entry.turn}:${entry.step}`),
  )
}

function SessionList({
  entries,
  markdown,
}: {
  entries: ReadonlyArray<SessionEntry>
  markdown: boolean
}): ReactNode {
  const complete = new Set(
    entries.flatMap((entry) =>
      entry.kind === 'assistant' ? [`${entry.turn}:${entry.step}`] : [],
    ),
  )
  return (
    <ol className="messages" data-testid="session">
      {entries.map((entry, index) => {
        if (entry.kind === 'input') {
          return (
            <li key={entry.id}>
              <article className="message person">
                <span className="who">you</span>
                <p>{entry.text}</p>
              </article>
            </li>
          )
        }
        if (entry.kind === 'chunk') {
          const key = `${entry.turn}:${entry.step}`
          const earlier = entries
            .slice(0, index)
            .some(
              (candidate) =>
                candidate.kind === 'chunk' &&
                candidate.turn === entry.turn &&
                candidate.step === entry.step,
            )
          if (complete.has(key) || earlier) return null
          const text = entries
            .filter(
              (
                candidate,
              ): candidate is Extract<SessionEntry, { kind: 'chunk' }> =>
                candidate.kind === 'chunk' &&
                candidate.turn === entry.turn &&
                candidate.step === entry.step,
            )
            .map((candidate) => candidate.text)
            .join('')
          return <li key={entry.id}>{assistantText(text, markdown, true)}</li>
        }
        if (entry.kind === 'assistant' && entry.text) {
          return <li key={entry.id}>{assistantText(entry.text, markdown)}</li>
        }
        if (entry.kind === 'tool-call' || entry.kind === 'human-tool-call') {
          return (
            <li
              className="tool"
              key={entry.id}
              data-testid={`tool-${entry.call.name}`}
            >
              <strong>{entry.call.name}</strong>
              <pre>{pretty(entry.call.args)}</pre>
            </li>
          )
        }
        if (entry.kind === 'error') {
          return (
            <li className="error" key={entry.id}>
              {entry.message}
            </li>
          )
        }
        return null
      })}
    </ol>
  )
}

/** The browser-only follower UI; no agent runtime is imported into it. */
export function AgentChat(): ReactNode {
  const snapshot = useComposeSnapshot()
  const view = useComposeView()
  const state = stateOf(snapshot)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const isRunning = state.status === 'running' || sending
  const markdown = active(snapshot, 'markdown')
  const title = active(snapshot, 'page-title')
  const enter = active(snapshot, 'send-on-enter')
  const controlEnter = active(snapshot, 'send-on-ctrl-enter')
  const working = pluginEntry(snapshot, 'working-indicator')
  const streaming = isStreaming(state.session)
  const workingText =
    typeof working?.options === 'object' &&
    working.options !== null &&
    'text' in working.options &&
    typeof working.options.text === 'string'
      ? working.options.text
      : 'Agent is working'

  useEffect(() => {
    if (title) document.title = 'Deployed self-modifying agent'
  }, [title])
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight
  }, [state.session.length])

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || isRunning || !view.dispatch) return
    setDraft('')
    setSending(true)
    try {
      await view.dispatch(sendAction, { text })
    } finally {
      setSending(false)
    }
  }
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    const matches =
      event.key === 'Enter' &&
      !event.shiftKey &&
      ((controlEnter && (event.ctrlKey || event.metaKey)) ||
        (enter && !event.ctrlKey && !event.metaKey))
    if (!matches) return
    event.preventDefault()
    void send()
  }

  return (
    <main className="shell">
      <section className="chat">
        <header>
          {title ? <h1 data-testid="page-title">Deployed agent</h1> : null}
          <p>
            The loop lives with this tenant; written plugins live in facets.
          </p>
        </header>
        <Slot of={chatMainSlot} />
        <div className="message-frame" ref={list}>
          <SessionList entries={state.session} markdown={markdown} />
          {working && isRunning && !streaming ? (
            <p className="working" data-testid="agent-working">
              {workingText}…
            </p>
          ) : null}
        </div>
        <form
          className="input"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <textarea
            aria-label="Message"
            rows={2}
            value={draft}
            placeholder="Ask the agent to change its plugin list"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={keyDown}
          />
          <div className="input-actions">
            <button type="submit" disabled={!draft.trim() || isRunning}>
              Send
            </button>
            {isRunning && view.dispatch ? (
              <button
                type="button"
                onClick={() => void view.dispatch?.(cancelAction, undefined)}
              >
                Cancel
              </button>
            ) : null}
            <Slot of={chatInputActionsSlot} props={{ draft }} />
          </div>
        </form>
      </section>
      <aside>
        <h2>Tenant plugin list</h2>
        <ul className="plugins" data-testid="plugin-list">
          {snapshot.pluginList.map((entry) => (
            <li key={entry.id}>
              <code>{entry.id}</code>
              <span>{entry.enabled === false ? 'disabled' : 'active'}</span>
            </li>
          ))}
        </ul>
        <Slot of={chatSideSlot} />
      </aside>
    </main>
  )
}

/** Seed the follower from SSR and connect it to the tenant RPC seams. */
export function DeployedAgent({
  snapshot,
  transport,
  follow = '/api/compose/follow',
}: {
  snapshot: ComposeSnapshot
  transport?: ComposeTransport
  follow?: string
}): ReactNode {
  const deployed = useMemo<ComposeTransport>(
    () =>
      transport ?? {
        edit: () => Promise.resolve(undefined),
        dispatch: (request) => dispatchCompose({ data: { request } }),
        press: (request) => pressCompose({ data: { request } }),
      },
    [transport],
  )
  return (
    <ComposeStart snapshot={snapshot} transport={deployed} follow={follow}>
      <AgentChat />
    </ComposeStart>
  )
}
