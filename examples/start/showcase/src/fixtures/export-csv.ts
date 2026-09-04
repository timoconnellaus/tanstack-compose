import { dataStub } from '../base'
import type { ShowcaseFixture } from './types'

/** Server half: read only through the data grant and build a CSV. */
export const exportCsvSource = `
let api: Stubs
const setup: Setup = ({ stubs }) => {
  api = stubs
}
export default setup

const cell = (value: string | number): string =>
  '"' + String(value).replaceAll('"', '""') + '"'

export async function csv(_input: undefined): Promise<string> {
  const rows = await api.data.rows()
  return [
    'id,name,city,amount,due',
    ...rows.map((row) =>
      [row.id, row.name, row.city, row.amount, row.due]
        .map(cell)
        .join(','),
    ),
  ].join('\\n')
}
`.trim()

/** View half: fill the toolbar and expose the last returned CSV in a pre. */
export const exportCsvView = `
let api: Stubs

async function fill(csv?: string): Promise<void> {
  const children: Array<ViewNode> = [
    {
      type: 'button',
      label: 'Export CSV',
      onPress: 'exportCsv',
      download: 'table.csv',
      mediaType: 'text/csv',
      tone: 'primary',
    },
  ]
  if (csv !== undefined) {
    children.push({ type: 'pre', text: csv, testId: 'csv-preview' })
  }
  await api.slots({
    slot: 'table.actions',
    view: {
      type: 'stack',
      children,
    },
  })
}

const setup: Setup = async ({ stubs }) => {
  api = stubs
  await fill()
}
export default setup

export async function exportCsv(): Promise<string> {
  const csv = await api.server({ handler: 'csv', input: undefined })
  await fill(csv)
  return csv
}
`.trim()

/** The table page's export-to-CSV written plugin pair. */
export const exportCsvFixture: ShowcaseFixture = {
  id: 'export-csv',
  source: exportCsvSource,
  view: exportCsvView,
  stubs: [dataStub],
}
