import { createClient, createContextKey, createPlugin } from '@tanstack/compose'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import {
  ComposeProvider,
  useClient,
  useClientErrors,
  useComposeView,
  useContextKey,
  useInstances,
  usePluginList,
  useStore,
} from '../src/index'
import type { Client } from '@tanstack/compose'
import type { ComposeView } from '../src/index'
import type { ReactNode } from 'react'

interface Clock {
  label: string
}

const clockKey = createContextKey<Clock>('clock')

const clockPlugin = createPlugin({
  name: 'clock',
  provides: [clockKey],
  setup(instance) {
    instance.provide(clockKey, { label: 'ticking' })
  },
})

let client: Client | undefined

afterEach(async () => {
  cleanup()
  await client?.destroy()
  client = undefined
})

const show = (ui: ReactNode, on: ComposeView): void => {
  render(<ComposeProvider client={on}>{ui}</ComposeProvider>)
}

const viewOf = (on: Client): ComposeView => ({
  pluginList: on.pluginList,
  instances: on.instances,
  context: on.context,
  errors: on.errors,
  getContext: on.getContext,
  inspect: on.inspect,
})

function Label(): ReactNode {
  const clock = useContextKey(clockKey)
  return (
    <span data-testid="label">{clock?.label ?? 'nothing provides it'}</span>
  )
}

describe('reading a context key from the page', () => {
  test('re-renders when the key is provided, withdrawn and provided again', async () => {
    client = createClient()
    await client.settled()
    show(<Label />, client)
    expect(screen.getByTestId('label').textContent).toBe('nothing provides it')

    await client.addPlugin({ id: 'clock', plugin: clockPlugin })
    await waitFor(() =>
      expect(screen.getByTestId('label').textContent).toBe('ticking'),
    )

    await client.setEnabled('clock', false)
    await waitFor(() =>
      expect(screen.getByTestId('label').textContent).toBe(
        'nothing provides it',
      ),
    )

    await client.setEnabled('clock', true)
    await waitFor(() =>
      expect(screen.getByTestId('label').textContent).toBe('ticking'),
    )
  })

  test('waits for the key instead of rendering nothing when asked to suspend', async () => {
    client = createClient()
    await client.settled()

    function Suspended(): ReactNode {
      const clock = useContextKey(clockKey, { suspend: true })
      return <span data-testid="suspended">{clock.label}</span>
    }

    show(
      <Suspense fallback={<span data-testid="waiting">waiting</span>}>
        <Suspended />
      </Suspense>,
      client,
    )
    expect(screen.getByTestId('waiting')).toBeDefined()

    await client.addPlugin({ id: 'clock', plugin: clockPlugin })
    await waitFor(() =>
      expect(screen.getByTestId('suspended').textContent).toBe('ticking'),
    )
  })

  test('says so when there is no provider above it', () => {
    expect(() => render(<Label />)).toThrow(/no ComposeProvider/)
  })
})

describe('reading the client from the page', () => {
  test('gives the same client the provider was handed', async () => {
    client = createClient()
    await client.settled()
    let seen: Client | undefined

    function Reader(): ReactNode {
      seen = useClient()
      return null
    }
    show(<Reader />, client)

    expect(seen).toBe(client)
  })

  test('distinguishes a read-only view from a mutating client', async () => {
    client = createClient()
    await client.settled()
    const view = viewOf(client)
    let seen: ComposeView | undefined

    function ViewReader(): ReactNode {
      seen = useComposeView()
      return null
    }
    show(<ViewReader />, view)
    expect(seen).toBe(view)

    function ClientReader(): ReactNode {
      useClient()
      return null
    }
    expect(() => show(<ClientReader />, view)).toThrow(
      /useClient\(\) requires a Client.*read-only ComposeView/,
    )
  })
})

describe('reading the client stores from the page', () => {
  test('re-renders the plugin list and the instances on a plugin-list edit', async () => {
    client = createClient()
    await client.settled()

    function Listing(): ReactNode {
      const entries = usePluginList()
      const instances = useInstances()
      const errors = useClientErrors()
      return (
        <span data-testid="listing">
          {entries.map((entry) => entry.id).join(',')}|
          {instances.map((one) => one.status).join(',')}|{errors.length}
        </span>
      )
    }
    show(<Listing />, client)
    expect(screen.getByTestId('listing').textContent).toBe('||0')

    await client.addPlugin({ id: 'clock', plugin: clockPlugin })

    await waitFor(() =>
      expect(screen.getByTestId('listing').textContent).toBe('clock|active|0'),
    )
  })

  test('re-renders a store a plugin published, through the re-exported hook', async () => {
    const beats = createContextKey<{ count: number }>('beats')
    client = createClient({
      plugins: [
        {
          id: 'beats',
          plugin: createPlugin({
            name: 'beats',
            provides: [beats],
            setup(instance) {
              instance.provide(beats, { count: 1 })
            },
          }),
        },
      ],
    })
    await client.settled()

    function Beats(): ReactNode {
      // `useStore` is the adapter's re-export, used here on an ordinary value.
      const label = useStore(client!.instances, (all) => all.length)
      return <span data-testid="beats">{label}</span>
    }
    show(<Beats />, client)

    expect(screen.getByTestId('beats').textContent).toBe('1')
  })
})
