import { httpStub } from '@tanstack/compose/grants'
import { dataStub, slotsStub } from '../base'
import type { ShowcaseFixture } from './types'

/** Currency conversion source used by page 5. */
export const currencySource = `
const setup: Setup = async ({ stubs }) => {
  const response = await stubs.http.fetch('currency', '/rates')
  if (!response.ok) throw new Error('currency service refused the request')
  const payload = JSON.parse(response.body) as { rates: { USD: number } }
  const rows = await stubs.data({ operation: 'rows' })
  await stubs.slots({
    slot: 'table.currency',
    key: 'usd',
    view: {
      type: 'stack',
      children: [
        { type: 'text', text: 'USD', tone: 'muted' },
        {
          type: 'pre',
          testId: 'currency-column',
          text: rows.map((row) => '$' + (row.amount * payload.rates.USD).toFixed(2)).join('\\n'),
        },
      ],
    },
  })
}
export default setup
`.trim()

/** Successful named-service fixture. */
export const currencyFixture: ShowcaseFixture = {
  id: 'currency-column',
  source: currencySource,
  stubs: [httpStub, dataStub, slotsStub],
  serializedStubs: ['http', 'data', 'currency.slots'],
}

/** Refused service source used by the negative proof on page 5. */
export const bankSource = `
const setup: Setup = async ({ stubs }) => {
  let message = 'bank unexpectedly answered'
  try {
    await stubs.http.fetch('bank', '/rates')
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  await stubs.slots({
    slot: 'notifications',
    key: 'bank-refusal',
    view: { type: 'text', text: message, tone: 'danger' },
  })
}
export default setup
`.trim()

/** Fixture that proves an ungranted service is refused with its own message. */
export const bankFixture: ShowcaseFixture = {
  id: 'bank-request',
  source: bankSource,
  stubs: [httpStub, slotsStub],
  serializedStubs: ['http', 'currency.slots'],
}
