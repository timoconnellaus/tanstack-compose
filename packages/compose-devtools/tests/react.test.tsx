import {
  createAction,
  createClient,
  createContextKey,
  createPlugin,
} from '@tanstack/compose'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { ComposeDevtoolsPanel } from '../src/react'
import type { Client } from '@tanstack/compose'

let client: Client | undefined

afterEach(async () => {
  cleanup()
  await client?.destroy()
  client = undefined
})

describe('React devtools panel', () => {
  test('the Instances tab explains a pending instance by named deps', async () => {
    const settings = createContextKey<string>('settings')
    const runTask = createAction<void, void>('tasks.run')
    const worker = createPlugin({
      name: 'worker',
      deps: [settings, runTask],
      setup() {},
    })
    client = createClient({
      plugins: [{ id: 'worker-instance', plugin: worker }],
    })
    await client.settled()

    render(<ComposeDevtoolsPanel client={client} theme="light" />)

    expect(screen.getByRole('button', { name: 'Instances' })).toBeDefined()
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'worker' })).toBeDefined()
      expect(
        screen.getByText((_, element) =>
          Boolean(
            element?.tagName === 'DIV' &&
            element.textContent === 'Waiting for: settings, tasks.run',
          ),
        ),
      ).toBeDefined()
    })
  })
})
