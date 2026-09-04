import {
  Slot,
  createSlot,
  isClient,
  useClient,
  useComposeView,
} from '@tanstack/react-compose'
import { act, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { ComposeStart } from '../src'
import type { ComposeSnapshot } from '../src'

const actions = createSlot('table.actions')

const snapshot: ComposeSnapshot = {
  generation: 4,
  pluginList: [
    {
      id: 'export-csv',
      plugin: { written: true },
      stubs: ['slots'],
    },
  ],
  instances: [
    {
      id: 'export-csv.view',
      plugin: 'export-csv.view',
      status: 'active',
      missing: [],
    },
  ],
  fills: [
    {
      id: 'fill-1',
      instanceId: 'export-csv.view',
      slot: actions.name,
      order: 0,
      view: {
        type: 'button',
        label: 'Export CSV',
        onPress: 'downloadCsv',
      },
    },
  ],
}

const Page = () => (
  <ComposeStart snapshot={snapshot}>
    <main>
      <h1>Invoices</h1>
      <Slot of={actions} />
    </main>
  </ComposeStart>
)

describe('snapshot hydration', () => {
  it('hydrates the server fills without changing the DOM', () => {
    const server = renderToString(<Page />)
    const container = document.createElement('div')
    container.innerHTML = server
    const before = container.innerHTML

    let root: ReturnType<typeof hydrateRoot> | undefined
    act(() => {
      root = hydrateRoot(container, <Page />)
    })

    expect(container.innerHTML).toBe(before)
    expect(container.textContent).toContain('Export CSV')
    act(() => root?.unmount())
  })

  it('provides an honest read-only view of snapshot entries', () => {
    let seen: ReturnType<typeof useComposeView> | undefined
    const Reader = () => {
      seen = useComposeView()
      return null
    }
    const page = render(
      <ComposeStart snapshot={snapshot}>
        <Reader />
      </ComposeStart>,
    )

    expect(isClient(seen!)).toBe(false)
    expect(seen?.pluginList.state).toEqual(snapshot.pluginList)
    expect(seen?.pluginList.state[0]).not.toHaveProperty('source')
    page.unmount()
  })

  it('rejects useClient under the follower with a specific error', () => {
    const ClientReader = () => {
      useClient()
      return null
    }

    expect(() =>
      render(
        <ComposeStart snapshot={snapshot}>
          <ClientReader />
        </ComposeStart>,
      ),
    ).toThrow(/useClient\(\) requires a Client.*read-only ComposeView/)
  })
})
