import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { TablePage } from '../src/app/table-page'
import { tableApp } from '../src/apps'
import { demoRows } from '../src/base'
import { press, pressInPanel, startApp } from './helpers/app'
import type { StartedApp } from './helpers/app'

let page: StartedApp | undefined

afterEach(async () => {
  await page?.stop()
  page = undefined
  vi.restoreAllMocks()
})

describe('the table page', () => {
  test('adds a CSV view without reload and removes the whole pair cleanly', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    page = await startApp(tableApp, <TablePage />)

    expect(screen.getAllByTestId('table-row')).toHaveLength(demoRows.length)
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull()

    await press(screen.getByRole('button', { name: 'Add: export to CSV' }))
    const exportButton = await screen.findByRole('button', {
      name: 'Export CSV',
    })

    await press(exportButton)
    const csv = await screen.findByTestId('csv-preview')
    const lines = csv.textContent.split('\n')
    expect(lines[0]).toBe('id,name,city,amount,due')
    expect(lines).toHaveLength(demoRows.length + 1)

    await pressInPanel('export-csv', 'Remove')

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull(),
    )
    expect(page.client.resources('export-csv')).toBeUndefined()
    expect(page.client.resources('export-csv.view')).toBeUndefined()
    expect(
      page.client.instances.state.some((entry) =>
        entry.id.startsWith('export-csv'),
      ),
    ).toBe(false)
  })
})
