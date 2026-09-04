import { Slot, useContextKey, usePluginList } from '@tanstack/react-compose'
import { useMemo } from 'react'
import { currencyColumn, demoRows, tableKey } from '../base'
import { bankFixture, currencyFixture } from '../fixtures'
import { useComposeWriter } from './app-frame'
import { useDeclareSlots } from './slots'
import type { ReactNode } from 'react'

/** Page 5: one named HTTP service and one documented refusal. */
export function CurrencyPage(): ReactNode {
  const writer = useComposeWriter()
  const entries = usePluginList()
  const table = useContextKey(tableKey)
  const declared = useMemo(() => [currencyColumn], [])
  useDeclareSlots(declared)
  const rows = table?.rows ?? demoRows
  return (
    <section className="page" data-testid="currency-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Page 5 · named network service</p>
          <h2>Invoice currency</h2>
          <p>The credential is attached behind the HTTP grant.</p>
        </div>
        <div className="fixture-buttons">
          <button
            type="button"
            disabled={entries.some((entry) => entry.id === currencyFixture.id)}
            onClick={() => void writer.add(currencyFixture)}
          >
            Add: USD column
          </button>
          <button
            type="button"
            disabled={entries.some((entry) => entry.id === bankFixture.id)}
            onClick={() => void writer.add(bankFixture)}
          >
            Try: bank service
          </button>
        </div>
      </div>
      <div className="currency-grid">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>AUD</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div aria-label="Currency column">
          <Slot of={currencyColumn} />
        </div>
      </div>
    </section>
  )
}
