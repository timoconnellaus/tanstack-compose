import {
  Slot,
  useClient,
  useContextKey,
  usePluginList,
} from '@tanstack/react-compose'
import { useMemo, useState } from 'react'
import { tableActions, tableKey } from '../base'
import { exportCsvFixture } from '../fixtures'
import { addWritten } from '../written'
import { useDeclareSlots } from './slots'
import type { ReactNode } from 'react'

const messageOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : String(error)

/** Page 1: add a server half and a view that fills the table toolbar. */
export function TablePage(): ReactNode {
  const client = useClient()
  const table = useContextKey(tableKey)
  const entries = usePluginList()
  const declared = useMemo(() => [tableActions], [])
  useDeclareSlots(declared)
  const [problem, setProblem] = useState<string>()
  const present = entries.some((entry) => entry.id === exportCsvFixture.id)

  if (!table) return <p>Starting table…</p>
  return (
    <section className="page" data-testid="table-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Page 1 · add UI</p>
          <h2>Invoices</h2>
          <p>{table.rows.length} fixed rows from ordinary base code.</p>
        </div>
        <button
          type="button"
          disabled={present}
          onClick={() => {
            setProblem(undefined)
            void addWritten(client, exportCsvFixture).catch((error) =>
              setProblem(messageOf(error)),
            )
          }}
        >
          Add: export to CSV
        </button>
      </div>
      <div className="slot-toolbar" aria-label="Table actions">
        <Slot of={tableActions} props={{ rows: table.rows }} />
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
            {table.rows.map((row) => (
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
