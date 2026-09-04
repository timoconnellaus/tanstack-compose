import { createFileRoute } from '@tanstack/react-router'
import { DeployedApp } from '../app/deployed-app'
import { BrowserHostileApp } from '#showcase-browser-pages'
import { HostilePage } from '../app/hostile-page'
import { hostileApp } from '../apps'
import { getComposeSnapshot } from '../compose-functions'
import type { ReactNode } from 'react'

export const Route = createFileRoute('/hostile')({
  ssr: import.meta.env.MODE !== 'browser',
  loader: () =>
    import.meta.env.MODE === 'browser'
      ? undefined
      : getComposeSnapshot({ data: 'hostile' }),
  component: HostileApp,
})

/** The hostile app: its own client, plugin list and panel. */
function HostileApp(): ReactNode {
  if (import.meta.env.MODE !== 'browser') {
    const snapshot = Route.useLoaderData()
    if (!snapshot) throw new Error('showcase: hostile snapshot is missing')
    return (
      <DeployedApp app={hostileApp} snapshot={snapshot}>
        <HostilePage />
      </DeployedApp>
    )
  }
  return <BrowserHostileApp />
}
