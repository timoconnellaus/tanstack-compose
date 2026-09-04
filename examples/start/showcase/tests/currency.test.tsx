import { screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { CurrencyPage } from '../src/app/currency-page'
import { currencyApp } from '../src/apps'
import { currencyRates } from '../src/services/currency-handler'
import { press, startApp } from './helpers/app'
import type { StartedApp } from './helpers/app'

let page: StartedApp | undefined

afterEach(async () => {
  await page?.stop()
  page = undefined
})

describe('the currency page', () => {
  test('uses the named service and shows an ungranted service refusal', async () => {
    page = await startApp(currencyApp, <CurrencyPage />)
    await press(screen.getByRole('button', { name: 'Add: USD column' }))
    const column = await screen.findByTestId('currency-column')
    expect(column.textContent.split('\n')[0]).toBe(
      `$${(125 * currencyRates.USD).toFixed(2)}`,
    )
    expect(column.textContent).not.toContain('server-owned')

    await press(screen.getByRole('button', { name: 'Try: bank service' }))
    expect(
      await screen.findByText('no service named "bank" is granted'),
    ).toBeTruthy()
  })
})
