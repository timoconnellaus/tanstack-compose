import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { TablePage } from '../src/app/table-page'
import { demoRows } from '../src/base'
import { exportCsvSource, exportCsvView } from '../src/fixtures'
import { press, startPage } from './helpers/app'
import type { StartedPage } from './helpers/app'

let page: StartedPage | undefined

afterEach(async () => {
  await page?.stop()
  page = undefined
  vi.restoreAllMocks()
})

describe('the paste-source panel', () => {
  test('adds the same checked CSV pair as the table fixture button', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    page = await startPage(<TablePage />)

    fireEvent.change(screen.getByLabelText('Plugin id'), {
      target: { value: 'manual-export' },
    })
    fireEvent.change(screen.getByLabelText('Plugin source'), {
      target: { value: exportCsvSource },
    })
    fireEvent.change(screen.getByLabelText('Plugin view'), {
      target: { value: exportCsvView },
    })
    fireEvent.change(screen.getByLabelText('Plugin grants'), {
      target: { value: 'data' },
    })
    await press(screen.getByRole('button', { name: 'Add' }))

    const exportButton = await screen.findByRole('button', {
      name: 'Export CSV',
    })
    await press(exportButton)
    await waitFor(() =>
      expect(
        screen.getByTestId('csv-preview').textContent.split('\n'),
      ).toHaveLength(demoRows.length + 1),
    )
    expect(
      page.client.inspect().find((one) => one.id === 'manual-export')?.status,
    ).toBe('active')
  })
})
