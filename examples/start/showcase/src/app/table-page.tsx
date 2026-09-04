import { Slot, useContextKey, usePluginList } from '@tanstack/react-compose'
import { useMemo, useState } from 'react'
import { demoRows, tableActions, tableKey } from '../base'
import { exportCsvFixture } from '../fixtures'
import { useComposeWriter } from './app-frame'
import { useDeclareSlots } from './slots'
import type { ReactNode } from 'react'

const messageOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : String(error)

/** Page 1: add a server half and a view that fills the table toolbar. */
export function TablePage(): ReactNode {
  const writer = useComposeWriter()
  const table = useContextKey(tableKey)
  const entries = usePluginList()
  const declared = useMemo(() => [tableActions], [])
  useDeclareSlots(declared)
  const [problem, setProblem] = useState<string>()
  const present = entries.some((entry) => entry.id === exportCsvFixture.id)

  const rows = table?.rows ?? demoRows
  return (
    <section className="page" data-testid="table-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Page 1 · add UI</p>
          <h2>Invoices</h2>
          <p>{rows.length} fixed rows from ordinary base code.</p>
        </div>
        <button
          type="button"
          disabled={present}
          onClick={() => {
            setProblem(undefined)
            void writer
              .add(exportCsvFixture)
              .catch((error) => setProblem(messageOf(error)))
          }}
        >
          Add: export to CSV
        </button>
      </div>
      <div className="slot-toolbar" aria-label="Table actions">
        <Slot of={tableActions} props={{ rows }} />
      </div>
      {problem === undefined ? null : <p className="error">{problem}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Id</th>
              <th>Name</th>
              <th>City</th>
              <th>Amount</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr data-testid="table-row" key={row.id}>
                <td>{row.id}</td>
                <td>{row.name}</td>
                <td>{row.city}</td>
                <td>{row.amount.toFixed(2)}</td>
                <td>{row.due}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
