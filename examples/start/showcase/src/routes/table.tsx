import { createFileRoute } from '@tanstack/react-router'
import { DeployedApp } from '../app/deployed-app'
import { BrowserTableApp } from '#showcase-browser-pages'
import { TablePage } from '../app/table-page'
import { tableApp } from '../apps'
import { getComposeSnapshot } from '../compose-functions'
import type { ReactNode } from 'react'

export const Route = createFileRoute('/table')({
  ssr: import.meta.env.MODE !== 'browser',
  loader: () =>
    import.meta.env.MODE === 'browser'
      ? undefined
      : getComposeSnapshot({ data: 'table' }),
  component: TableApp,
})

/** The table app: its own client, plugin list and panel. */
function TableApp(): ReactNode {
  if (import.meta.env.MODE !== 'browser') {
    const snapshot = Route.useLoaderData()
    if (!snapshot) throw new Error('showcase: table snapshot is missing')
    return (
      <DeployedApp app={tableApp} snapshot={snapshot}>
        <TablePage />
      </DeployedApp>
    )
  }
  return <BrowserTableApp />
}
