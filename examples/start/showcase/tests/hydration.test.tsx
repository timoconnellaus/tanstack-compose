import { act } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ComposeStart } from '@tanstack/start-compose'
import { AppFrame } from '../src/app/app-frame'
import { TablePage } from '../src/app/table-page'
import { tableApp } from '../src/apps'
import type { ComposeSnapshot, ComposeTransport } from '@tanstack/start-compose'

const snapshot: ComposeSnapshot = {
  generation: 9,
  pluginList: [
    { id: 'slots', plugin: { catalog: 'slots' }, stubs: [] },
    { id: 'views', plugin: { catalog: 'views' }, stubs: [] },
    { id: 'table', plugin: { catalog: 'table' }, stubs: [] },
    {
      id: 'export-csv',
      plugin: { written: true },
      stubs: ['data'],
      host: 'cloudflare',
    },
    {
      id: 'export-csv.view',
      plugin: { written: true },
      stubs: ['table.slots', 'server'],
      host: 'cloudflare',
    },
  ],
  instances: [
    { id: 'slots', plugin: 'slots', status: 'active', missing: [] },
    { id: 'views', plugin: 'views', status: 'active', missing: [] },
    { id: 'table', plugin: 'table', status: 'active', missing: [] },
    { id: 'export-csv', plugin: 'hosted', status: 'active', missing: [] },
    {
      id: 'export-csv.view',
      plugin: 'hosted',
      status: 'active',
      missing: [],
    },
  ],
  fills: [
    {
      id: 'csv-fill',
      instanceId: 'export-csv.view',
      slot: 'table.actions',
      order: 0,
      view: {
        type: 'button',
        label: 'Export CSV',
        onPress: 'downloadCsv',
      },
    },
  ],
}

const transport: ComposeTransport = {
  edit: () => Promise.resolve(),
  press: () => Promise.resolve(undefined),
}

const Page = () => (
  <ComposeStart snapshot={snapshot} transport={transport}>
    <AppFrame app={tableApp}>
      <TablePage />
    </AppFrame>
  </ComposeStart>
)

describe('the server-rendered Table page', () => {
  it('hydrates with its export fill without changing the DOM', async () => {
    const html = renderToString(<Page />)
    const container = document.createElement('div')
    container.innerHTML = html
    const before = container.innerHTML

    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(container, <Page />)
    })
    expect(container.innerHTML).toBe(before)
    expect(container.textContent).toContain('Export CSV')
    expect(
      container.querySelectorAll('[data-testid="table-row"]'),
    ).toHaveLength(30)
    await act(async () => root?.unmount())
  })
})
