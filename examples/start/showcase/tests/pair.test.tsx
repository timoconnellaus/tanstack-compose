import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { PairPage } from '../src/app/pair-page'
import { pairApp } from '../src/apps'
import { press, startApp } from './helpers/app'
import type { StartedApp } from './helpers/app'

let page: StartedApp | undefined

afterEach(async () => {
  await page?.stop()
  page = undefined
})

describe('the written pair', () => {
  test('keeps B waiting until A is active and revives it after A returns', async () => {
    page = await startApp(pairApp, <PairPage />)
    await press(screen.getByRole('button', { name: 'Add B' }))
    await waitFor(() =>
      expect(screen.getByTestId('pair-b-status').textContent).toContain(
        'pending',
      ),
    )

    await press(screen.getByRole('button', { name: 'Add A' }))
    await waitFor(() =>
      expect(screen.getByTestId('pair-b-status').textContent).toContain(
        'active',
      ),
    )

    await press(screen.getByRole('button', { name: 'Remove A' }))
    await waitFor(() =>
      expect(screen.getByTestId('pair-b-status').textContent).toContain(
        'pending',
      ),
    )

    await press(screen.getByRole('button', { name: 'Add A' }))
    await waitFor(() =>
      expect(screen.getByTestId('pair-b-status').textContent).toContain(
        'active',
      ),
    )
  })
})
