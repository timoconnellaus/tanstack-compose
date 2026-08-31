import { createClient, createPlugin } from '@tanstack/compose'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import {
  ComposeProvider,
  Slot,
  createSlot,
  createSlotRegistry,
  resolveFills,
  slotsKey,
  slotsPlugin,
} from '../src/index'
import type { Client } from '@tanstack/compose'
import type { ReactNode } from 'react'

const toolbar = createSlot<{ busy: boolean }>('toolbar')
const banner = createSlot('banner', { cardinality: 'single' })
const row = createSlot<{ kind: string }>('row', {
  cardinality: 'keyed',
  key: (props) => props.kind,
})

let client: Client | undefined

afterEach(async () => {
  cleanup()
  await client?.destroy()
  client = undefined
})

const startedClient = async (): Promise<Client> => {
  client = createClient({ plugins: [{ id: 'slots', plugin: slotsPlugin }] })
  await client.settled()
  return client
}

const show = (ui: ReactNode, on: Client): ReturnType<typeof render> =>
  render(<ComposeProvider client={on}>{ui}</ComposeProvider>)

describe('a slot filled by several plugins', () => {
  test('renders every fill, lowest order first', async () => {
    const started = await startedClient()
    const slots = started.getContext(slotsKey)!
    slots.fill(toolbar, { order: 10, render: () => <span>second</span> })
    slots.fill(toolbar, { order: 1, render: () => <span>first</span> })

    show(<Slot of={toolbar} props={{ busy: false }} />, started)

    expect(document.body.textContent).toBe('firstsecond')
  })

  test('keeps registration order between fills of equal order', () => {
    const registry = createSlotRegistry()
    registry.fill(toolbar, { render: () => null })
    registry.fill(toolbar, { render: () => null })
    const [one, other] = registry.fills(toolbar)

    expect([one?.id, other?.id]).toEqual(['toolbar#1', 'toolbar#2'])
  })

  test('passes the slot props to each fill', async () => {
    const started = await startedClient()
    started.getContext(slotsKey)!.fill(toolbar, {
      render: ({ busy }) => <span>{busy ? 'busy' : 'idle'}</span>,
    })

    show(<Slot of={toolbar} props={{ busy: true }} />, started)

    expect(screen.getByText('busy')).toBeDefined()
  })

  test('lets the renderer of a slot wrap each fill without knowing them', async () => {
    const started = await startedClient()
    started.getContext(slotsKey)!.fill(toolbar, { render: () => <>one</> })

    show(
      <ul>
        <Slot of={toolbar} props={{ busy: false }}>
          {(rendered, fill) => <li data-testid={fill.id}>{rendered}</li>}
        </Slot>
      </ul>,
      started,
    )

    expect(screen.getByTestId('toolbar#1').tagName).toBe('LI')
  })
})

describe('a slot that takes a single fill', () => {
  test('renders the fill registered last', async () => {
    const started = await startedClient()
    const slots = started.getContext(slotsKey)!
    slots.fill(banner, { render: () => <span>old</span> })
    slots.fill(banner, { render: () => <span>new</span> })

    show(<Slot of={banner} />, started)

    expect(document.body.textContent).toBe('new')
  })
})

describe('a slot whose fills are keyed by its props', () => {
  test('renders the fill registered for the key the props carry', async () => {
    const started = await startedClient()
    const slots = started.getContext(slotsKey)!
    slots.fill(row, { key: 'note', render: () => <span>a note</span> })
    slots.fill(row, { key: 'warning', render: () => <span>a warning</span> })

    show(<Slot of={row} props={{ kind: 'warning' }} />, started)

    expect(document.body.textContent).toBe('a warning')
  })

  test('keeps the latest fill for a key and leaves the other keys alone', () => {
    const registry = createSlotRegistry()
    registry.fill(row, { key: 'note', render: () => null })
    registry.fill(row, { key: 'warning', render: () => null })
    registry.fill(row, { key: 'note', render: () => null })

    expect(registry.fills(row).map((fill) => fill.key)).toEqual([
      'note',
      'warning',
    ])
    expect(registry.fills(row).map((fill) => fill.id)).toEqual([
      'row#3',
      'row#2',
    ])
  })

  test('renders nothing for a key nothing fills', async () => {
    const started = await startedClient()
    started
      .getContext(slotsKey)!
      .fill(row, { key: 'note', render: () => <span>a note</span> })

    show(<Slot of={row} props={{ kind: 'nothing-fills-this' }} />, started)

    expect(document.body.textContent).toBe('')
  })
})

describe('a slot no plugin fills', () => {
  test('renders nothing and does not throw', async () => {
    const started = await startedClient()

    expect(() =>
      show(<Slot of={toolbar} props={{ busy: false }} />, started),
    ).not.toThrow()
    expect(document.body.textContent).toBe('')
  })

  test('renders nothing when no plugin provides the registry at all', async () => {
    client = createClient()
    await client.settled()

    show(<Slot of={toolbar} props={{ busy: false }} />, client)

    expect(document.body.textContent).toBe('')
  })
})

describe('a plugin filling and unfilling while the page is up', () => {
  const filler = createPlugin({
    name: 'filler',
    deps: [slotsKey],
    setup(instance) {
      instance.cleanup(
        instance.context
          .get(slotsKey)
          .fill(toolbar, { render: () => <span>from a plugin</span> }),
      )
    },
  })

  test('reaches the page when the plugin is added and leaves when it goes', async () => {
    const started = await startedClient()
    show(<Slot of={toolbar} props={{ busy: false }} />, started)
    expect(document.body.textContent).toBe('')

    await started.addPlugin({ id: 'filler', plugin: filler })
    await screen.findByText('from a plugin')

    await started.setEnabled('filler', false)
    expect(document.body.textContent).toBe('')
    expect(started.inspect().find((one) => one.id === 'slots')?.status).toBe(
      'active',
    )
  })

  test('leaves the fills of other slots untouched', async () => {
    const started = await startedClient()
    const slots = started.getContext(slotsKey)!
    slots.fill(banner, { render: () => null })
    const before = slots.state.state.fills.banner

    slots.fill(toolbar, { render: () => null })

    expect(slots.state.state.fills.banner).toBe(before)
  })
})

describe('resolving a slot by name', () => {
  test('finds a slot the plugin that renders it declared', () => {
    const registry = createSlotRegistry()
    registry.declare(toolbar)

    expect(registry.slot('toolbar')).toBe(toolbar)
    expect(registry.slots()).toEqual([toolbar])
  })

  test('finds a slot that has only been filled', () => {
    const registry = createSlotRegistry()
    registry.fill(row, { key: 'note', render: () => null })

    expect(registry.slot('row')?.cardinality).toBe('keyed')
  })

  test('forgets a slot once its declaration and its fills are gone', () => {
    const registry = createSlotRegistry()
    const undeclare = registry.declare(toolbar)
    const unfill = registry.fill(toolbar, { render: () => null })

    undeclare()
    expect(registry.slot('toolbar')).toBe(toolbar)

    unfill()
    expect(registry.slot('toolbar')).toBeUndefined()
  })

  test('settles fills of a slot found by name the way that slot says', () => {
    const registry = createSlotRegistry()
    registry.declare(banner)
    registry.fill(banner, { render: () => null })
    registry.fill(banner, { render: () => null })
    const found = registry.slot('banner')!

    expect(
      resolveFills(found, registry.state.state.fills.banner ?? []),
    ).toEqual(registry.fills(banner))
    expect(registry.fills(found)).toHaveLength(1)
  })
})

describe('a fill that renders a slot of its own', () => {
  test('renders the nested slot in place', async () => {
    const started = await startedClient()
    const slots = started.getContext(slotsKey)!
    slots.fill(toolbar, {
      render: () => (
        <>
          <span>outer</span>
          <Slot of={banner} />
        </>
      ),
    })
    slots.fill(banner, { render: () => <span>inner</span> })

    show(<Slot of={toolbar} props={{ busy: false }} />, started)

    expect(document.body.textContent).toBe('outerinner')
  })
})

describe('the registry a plugin provides', () => {
  test('is one registry for the life of the client', async () => {
    const started = await startedClient()
    const first = started.getContext(slotsKey)

    await started.addPlugin({
      id: 'other',
      plugin: createPlugin({ name: 'other', setup: () => {} }),
    })

    expect(started.getContext(slotsKey)).toBe(first)
  })
})
