import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { agentKey } from '@tanstack/compose-example-agent-runtime'
import { press, pressInPanel, sendMessage, startApp } from './helpers/app'
import type { StartedApp } from './helpers/app'

let app: StartedApp | undefined

afterEach(async () => {
  cleanup()
  await app?.stop()
  app = undefined
})

describe('the page as it starts', () => {
  test('is assembled entirely out of the enabled plugin entries', async () => {
    app = await startApp()

    expect(screen.getByTestId('page-frame')).toBeDefined()
    expect(screen.getByTestId('page-title')).toBeDefined()
    expect(screen.getByTestId('messages')).toBeDefined()
    expect(screen.getByTestId('input-box')).toBeDefined()
    expect(screen.getByTestId('stop-button')).toBeDefined()
    expect(screen.getByTestId('plugin-panel')).toBeDefined()
    expect(screen.getByTestId('model-picker')).toBeDefined()
    expect(screen.getByTestId('action-log')).toBeDefined()
  })

  test('lists every plugin entry with its status', async () => {
    app = await startApp()

    expect(screen.getByTestId('plugin-loop').textContent).toContain('active')
    expect(screen.getByTestId('plugin-composer').textContent).toContain(
      'active',
    )
  })
})

describe('the conversation', () => {
  test('renders assistant text as Markdown', async () => {
    app = await startApp({ script: [{ chunks: ['This is **bold**.'] }] })

    await sendMessage('show me Markdown')
    await app.client.getContext(agentKey)!.idle()

    const strong = await screen.findByText('bold', { selector: 'strong' })
    expect(strong.closest('.message-assistant')).not.toBeNull()
  })

  test('collapses a tool call and its result into one expandable row', async () => {
    app = await startApp({
      script: [
        {
          chunks: ['Checking.'],
          toolCalls: [{ name: 'list_plugins', args: {} }],
        },
        { chunks: ['Done.'] },
      ],
    })

    await sendMessage('what are you made of?')
    await app.client.getContext(agentKey)!.idle()

    const row = await screen.findByTestId('tool-call-call-1')
    const toggle = row.querySelector('button')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(row.textContent).toContain('list_plugins')
    expect(row.textContent).toContain('ok')
    expect(row.querySelector('.tool-details')).toBeNull()

    await press(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(row.querySelector('.tool-details')?.textContent).toContain(
      'Arguments',
    )
    expect(row.querySelector('.tool-details')?.textContent).toContain('Result')
  })

  test('stops following when the person scrolls up', async () => {
    app = await startApp()
    const messages = screen.getByTestId('messages')
    Object.defineProperties(messages, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 800 },
    })
    messages.scrollTop = 100

    fireEvent.scroll(messages)

    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeDefined()
  })
})

/**
 * One element at a time, through the panel, in a fresh client each time: the
 * element goes and what is left keeps working.
 */
const shell: Array<{ id: string; gone: string; stays: string }> = [
  { id: 'page-frame', gone: 'page-frame', stays: 'page-frame' },
  { id: 'page-title', gone: 'page-title', stays: 'page-frame' },
  { id: 'message-list', gone: 'messages', stays: 'input-box' },
  { id: 'input-box', gone: 'input-box', stays: 'messages' },
  { id: 'stop-button', gone: 'stop-button', stays: 'input-box' },
  { id: 'model-picker', gone: 'model-picker', stays: 'plugin-panel' },
  { id: 'action-log', gone: 'action-log', stays: 'plugin-panel' },
  { id: 'plugin-panel', gone: 'plugin-panel', stays: 'input-box' },
]

describe('disabling one element of the page', () => {
  for (const element of shell) {
    test(`takes ${element.id} off the page and leaves the rest working`, async () => {
      app = await startApp()
      expect(screen.getByTestId(element.gone)).toBeDefined()

      await pressInPanel(element.id, 'Disable')

      await waitFor(() => expect(screen.queryByTestId(element.gone)).toBeNull())
      if (element.id !== 'page-frame') {
        expect(screen.getByTestId(element.stays)).toBeDefined()
      }
      expect(
        app.client.inspect().filter((one) => one.status === 'error'),
      ).toEqual([])
    })
  }

  test('puts the element back when the entry is enabled again', async () => {
    app = await startApp()

    await pressInPanel('stop-button', 'Disable')
    await waitFor(() => expect(screen.queryByTestId('stop-button')).toBeNull())

    await pressInPanel('stop-button', 'Enable')
    await waitFor(() => expect(screen.getByTestId('stop-button')).toBeDefined())
  })

  test('a protected entry offers no buttons, and the composer refuses it anyway', async () => {
    app = await startApp()

    const row = screen.getByTestId('plugin-loop')
    expect(row.textContent).toContain('protected')
    expect(row.querySelector('button')).toBeNull()

    const agent = app.client.getContext(agentKey)
    expect(agent).toBeDefined()
    await agent!.invoke('disable_plugin', { id: 'loop' })

    await waitFor(() =>
      expect(
        app!.session
          .snapshot()
          .some(
            (entry) =>
              entry.kind === 'human-tool-result' &&
              entry.name === 'disable_plugin' &&
              entry.outcome.ok &&
              (entry.outcome.value as { ok: boolean; error?: string }).error ===
                'the entry "loop" is protected and cannot be changed',
          ),
      ).toBe(true),
    )
    expect(screen.getByTestId('plugin-loop').textContent).toContain('active')
  })
})
