import { agentKey } from '@tanstack/compose-agent'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import {
  press,
  pressInPanel,
  sendMessage,
  slowModel,
  startApp,
} from './helpers/app'
import type { StartedApp } from './helpers/app'

let app: StartedApp | undefined

afterEach(async () => {
  cleanup()
  await app?.stop()
  app = undefined
})

const stopButton = (): HTMLButtonElement =>
  screen.getByTestId('stop-button') as HTMLButtonElement

describe('the stop button', () => {
  test('is enabled only while a turn is running', async () => {
    app = await startApp({ model: slowModel })
    expect(stopButton().disabled).toBe(true)

    await sendMessage('take your time')
    expect(stopButton().disabled).toBe(false)

    await app.client.getContext(agentKey)!.idle()
    await waitFor(() => expect(stopButton().disabled).toBe(true))
  })

  test('cancels the open turn when pressed', async () => {
    app = await startApp({ model: slowModel })
    await sendMessage('take your time')

    await press(stopButton())

    await waitFor(() =>
      expect(
        app!.session
          .snapshot()
          .some(
            (entry) =>
              entry.kind === 'turn-closed' && entry.reason === 'cancelled',
          ),
      ).toBe(true),
    )
    await waitFor(() => expect(stopButton().disabled).toBe(true))
  })
})

describe('an edit a person makes in the plugin panel', () => {
  test('reaches the session as a tool call with its result', async () => {
    app = await startApp()

    await pressInPanel('action-log', 'Disable')

    await waitFor(() => {
      const entries = app!.session.snapshot()
      expect(
        entries.some(
          (entry) =>
            entry.kind === 'tool-call' &&
            entry.call.name === 'disable_plugin' &&
            (entry.call.args as { id: string }).id === 'action-log',
        ),
      ).toBe(true)
      expect(
        entries.some(
          (entry) =>
            entry.kind === 'tool-result' &&
            entry.name === 'disable_plugin' &&
            entry.outcome.ok,
        ),
      ).toBe(true)
    })
  })

  test('shows in the message list, because the message list renders the session', async () => {
    app = await startApp()

    await pressInPanel('model-picker', 'Disable')

    await waitFor(() =>
      expect(screen.getByTestId('messages').textContent).toContain(
        'disable_plugin',
      ),
    )
  })
})

describe('middleware wrapped around the page', () => {
  test('sees a person pressing Send', async () => {
    app = await startApp({ model: slowModel })

    await sendMessage('hello there')

    await waitFor(() =>
      expect(screen.getByTestId('action-log').textContent).toContain(
        'send "hello there"',
      ),
    )
  })

  test('sees a person pressing Stop', async () => {
    app = await startApp({ model: slowModel })
    await sendMessage('take your time')

    await press(stopButton())

    await waitFor(() =>
      expect(screen.getByTestId('action-log').textContent).toContain(
        'cancel the turn',
      ),
    )
  })

  test('sees a tool call the panel made and one the model made alike', async () => {
    app = await startApp()

    await pressInPanel('model-picker', 'Disable')
    await waitFor(() =>
      expect(screen.getByTestId('action-log').textContent).toContain(
        'panel calls disable_plugin',
      ),
    )

    // The canned conversation calls `list_plugins` on its second turn.
    await sendMessage('hello')
    await sendMessage('what are you made of?')

    await waitFor(() =>
      expect(screen.getByTestId('action-log').textContent).toContain(
        'calls list_plugins',
      ),
    )
  })
})
