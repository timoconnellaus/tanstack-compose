import { createFileRoute } from '@tanstack/react-router'
import { AppFrame } from '../app/app-frame'
import { TablePage } from '../app/table-page'
import { tableApp } from '../apps'
import { getBrowserClient } from '../browser-clients'
import type { ReactNode } from 'react'

export const Route = createFileRoute('/table')({
  ssr: false,
  component: TableApp,
})

/** The table app: its own client, plugin list and panel. */
function TableApp(): ReactNode {
  return (
    <AppFrame app={tableApp} client={getBrowserClient(tableApp)}>
      <TablePage />
    </AppFrame>
  )
}
