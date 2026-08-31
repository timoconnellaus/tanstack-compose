import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { pressInPanel, startApp } from './helpers/app'
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

/**
 * One element at a time, through the panel, in a fresh client each time: the
 * element goes and what is left keeps working.
 */
const shell: Array<{ id: string; gone: string; stays: string }> = [
  { id: 'page-frame', gone: 'page-frame', stays: 'page-frame' },
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

  test('refuses to disable an entry the operator protected', async () => {
    app = await startApp()

    await pressInPanel('loop', 'Disable')

    await waitFor(() =>
      expect(
        app!.session
          .snapshot()
          .some(
            (entry) =>
              entry.kind === 'tool-result' &&
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
