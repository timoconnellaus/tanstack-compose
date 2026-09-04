import { agentKey } from '@tanstack/compose-agent'
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { pressInPanel, sendMessage, slowModel, startApp } from './helpers/app'
import type { StartedApp } from './helpers/app'

let app: StartedApp | undefined

afterEach(async () => {
  cleanup()
  await app?.stop()
  app = undefined
})

/**
 * The pieces a person might reasonably switch off or swap are plugins of their
 * own: the working indicator, markdown, the page title, and which key sends.
 * Each fills a slot or binds a registry another plugin publishes, and goes when
 * its entry is disabled.
 */

describe('the working indicator', () => {
  test('shows while a turn runs and goes with its entry', async () => {
    app = await startApp({ model: slowModel })
    expect(screen.queryByTestId('agent-working')).toBeNull()

    await sendMessage('take your time')
    await waitFor(() =>
      expect(screen.getByTestId('agent-working')).toBeDefined(),
    )

    await app.client.getContext(agentKey)!.idle()
    await waitFor(() =>
      expect(screen.queryByTestId('agent-working')).toBeNull(),
    )

    await pressInPanel('working-indicator', 'Disable')
    await sendMessage('again')
    expect(screen.queryByTestId('agent-working')).toBeNull()
    await app.client.getContext(agentKey)!.idle()
  })
})

describe('markdown', () => {
  test('renders assistant text, and plain paragraphs take over without it', async () => {
    app = await startApp({
      script: [{ chunks: ['A **bold** word'] }, { chunks: ['Still **bold**'] }],
    })

    await sendMessage('hello')
    await app.client.getContext(agentKey)!.idle()
    await waitFor(() => {
      const markdown = screen.getAllByTestId('markdown')
      expect(markdown[0].querySelector('strong')?.textContent).toBe('bold')
    })
    expect(screen.queryByTestId('plain-text')).toBeNull()

    await pressInPanel('markdown', 'Disable')
    await waitFor(() => expect(screen.queryByTestId('markdown')).toBeNull())
    const plain = screen.getAllByTestId('plain-text')
    expect(plain[0].textContent).toContain('A **bold** word')
    expect(plain[0].querySelector('strong')).toBeNull()
  })
})

describe('which key sends', () => {
  const type = (text: string): void => {
    act(() => {
      fireEvent.change(screen.getByLabelText('Message'), {
        target: { value: text },
      })
    })
  }
  const key = async (init: KeyboardEventInit): Promise<void> => {
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('Message'), init)
      await Promise.resolve()
    })
  }
  const inputs = (): Array<string> =>
    app!.session
      .snapshot()
      .flatMap((entry) => (entry.kind === 'input' ? [entry.text] : []))

  test('is Enter by default, and Ctrl+Enter once the entries are swapped', async () => {
    app = await startApp({ script: [{ chunks: ['ok'] }, { chunks: ['ok'] }] })
    const agent = app.client.getContext(agentKey)!

    type('one')
    await key({ key: 'Enter', ctrlKey: true })
    expect(inputs()).toEqual([])
    await key({ key: 'Enter' })
    await waitFor(() => expect(inputs()).toEqual(['one']))
    await agent.idle()

    await pressInPanel('send-on-enter', 'Disable')
    await agent.invoke('add_plugin', {
      id: 'send-on-ctrl-enter',
      name: 'send-on-ctrl-enter',
    })
    await app.client.settled()

    type('two')
    await key({ key: 'Enter' })
    expect(inputs()).toEqual(['one'])
    await key({ key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(inputs()).toEqual(['one', 'two']))
    await agent.idle()
  })
})
