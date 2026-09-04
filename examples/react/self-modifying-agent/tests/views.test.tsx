import { agentKey } from '@tanstack/compose-example-agent-runtime'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import {
  summariserSource,
  summariserView,
  summariserViewWithATypeError,
} from '../src/written'
import { press, sendMessage, startApp } from './helpers/app'
import type { Client } from '@tanstack/compose'
import type {
  ComposerResult,
  ScriptedResponse,
} from '@tanstack/compose-example-agent-runtime'
import type { StartedApp } from './helpers/app'

let app: StartedApp | undefined

afterEach(async () => {
  cleanup()
  await app?.stop()
  app = undefined
})

/** One `write_plugin` turn: the call, then the sentence that closes the turn. */
const writes = (source: string): Array<ScriptedResponse> => [
  {
    chunks: ['Writing it now.'],
    toolCalls: [
      {
        name: 'write_plugin',
        args: {
          id: 'summariser',
          source: source === '' ? summariserSource : source,
        },
      },
    ],
  },
  { chunks: ['Done.'] },
]

/** The result of the last composer tool the model called. */
const lastResult = (started: StartedApp): ComposerResult | undefined =>
  started.session
    .snapshot()
    .filter((entry) => entry.kind === 'tool-result')
    .map((entry) => (entry as { outcome: { value?: unknown } }).outcome.value)
    .at(-1) as ComposerResult | undefined

/**
 * Every instance's status, so a test can show that nothing it did restarted the
 * loop and that removing a written plugin left nothing behind.
 */
const watchLoop = (client: Client) => {
  const statusOf = () =>
    client.inspect().find((one) => one.id === 'loop')?.status ?? 'missing'
  const statuses: Array<string> = [statusOf()]
  const subscription = client.instances.subscribe(() => {
    const status = statusOf()
    if (status !== statuses[statuses.length - 1]) statuses.push(status)
  })
  return { statuses, stop: () => subscription.unsubscribe() }
}

const summarise = (): HTMLElement =>
  screen.getByRole('button', { name: 'Summarise' })

describe('a plugin the model writes with a view', () => {
  test('puts a button beside Stop, and pressing it reaches the plugin the view belongs to', async () => {
    app = await startApp({
      script: [
        ...writes(summariserView),
        ...writes(summariserView),
        { chunks: ['Anything else?'] },
      ],
    })
    const loop = watchLoop(app.client)
    expect(screen.queryByRole('button', { name: 'Summarise' })).toBeNull()

    await sendMessage('give me a summarise button')

    // The button is on the page, beside Stop, with no reload and nothing else
    // re-rendered: it is a fill of the slot the input box declares.
    await waitFor(() => expect(summarise()).toBeDefined())
    const actions = summarise().closest('.input-actions')!
    expect(actions.contains(screen.getByTestId('stop-button'))).toBe(true)

    // Pressing it runs the view's own handler, which reads the end of the
    // session, calls the plugin's server half through the `server` stub, and
    // fills the same place again with what came back.
    await press(summarise())
    await waitFor(() =>
      expect(actions.textContent).toMatch(/summary: \d+ words/),
    )
    expect(summarise()).toBeDefined()

    // The same handler is the tool the plugin registered, so running it as a
    // **human step** puts what the written code produced into the session.
    const outcome = await app.client
      .getContext(agentKey)!
      .invoke('summarise', { text: 'one two three' })
    expect(outcome).toEqual({ ok: true, value: 'summary: 3 words' })
    await waitFor(() =>
      expect(
        app!.session
          .snapshot()
          .some(
            (entry) =>
              entry.kind === 'human-tool-result' &&
              entry.name === 'summarise' &&
              entry.outcome.ok &&
              entry.outcome.value === 'summary: 3 words',
          ),
      ).toBe(true),
    )

    loop.stop()
    expect(loop.statuses).toEqual(['active'])
  })

  test('takes the button off the page when the model removes the plugin, leaving nothing behind', async () => {
    app = await startApp({
      script: [
        ...writes(summariserView),
        {
          chunks: ['Taking it off again.'],
          toolCalls: [{ name: 'remove_plugin', args: { id: 'summariser' } }],
        },
        { chunks: ['Gone.'] },
      ],
    })
    const loop = watchLoop(app.client)

    await sendMessage('give me a summarise button')
    await waitFor(() => expect(summarise()).toBeDefined())

    await sendMessage('take it away again')

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Summarise' })).toBeNull(),
    )
    // The one source entry owned both the tool and the fill.
    const ids = app.client.pluginList.state.map((entry) => entry.id)
    expect(ids).not.toContain('summariser')
    // The tool it registered went with it, so the model cannot call it again.
    expect(
      await app.client.getContext(agentKey)!.invoke('summarise', { text: 'x' }),
    ).toEqual({ ok: false, error: 'unknown tool "summarise"' })
    // The rest of the page is untouched.
    expect(screen.getByTestId('stop-button')).toBeDefined()
    expect(
      app.client.inspect().filter((one) => one.status === 'error'),
    ).toEqual([])

    loop.stop()
    expect(loop.statuses).toEqual(['active'])
  })

  test('is refused with diagnostics when the view calls a handler the plugin does not export', async () => {
    app = await startApp({
      script: [
        ...writes(summariserViewWithATypeError),
        { chunks: ['I will try again.'] },
      ],
    })

    await sendMessage('give me a summarise button')

    await waitFor(() => expect(lastResult(app!)?.ok).toBe(false))
    const result = lastResult(app)
    expect(result?.diagnostics?.[0]?.message).toContain(
      `'handlerName' does not exist`,
    )
    // Neither half was written, so there is no button and no half-built plugin.
    expect(result?.entries).toEqual([])
    expect(screen.queryByRole('button', { name: 'Summarise' })).toBeNull()
    expect(app.client.pluginList.state.map((one) => one.id)).not.toContain(
      'summariser',
    )
  })

  test('cannot fill a slot the operator did not grant it', async () => {
    const elsewhere = summariserSource.replace(
      "slot: 'chat.input.actions'",
      "slot: 'root'",
    )
    app = await startApp({
      script: [...writes(elsewhere), { chunks: ['Understood.'] }],
    })

    await sendMessage('put it in the page frame')

    await waitFor(() => expect(lastResult(app!)?.ok).toBe(false))
    expect(lastResult(app)?.diagnostics?.[0]?.message).toContain(
      `Type '"root"' is not assignable to type`,
    )
    expect(screen.getByTestId('page-frame')).toBeDefined()
  })
})
