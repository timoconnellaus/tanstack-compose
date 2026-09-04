import { createFileRoute } from '@tanstack/react-router'
import { BrowserUpgradeApp } from '#showcase-browser-pages'
import { DeployedApp } from '../app/deployed-app'
import { UpgradePage } from '../app/upgrade-page'
import { upgradeApp } from '../apps'
import { getComposeSnapshot } from '../compose-functions'
import type { ReactNode } from 'react'

export const Route = createFileRoute('/upgrade')({
  ssr: import.meta.env.MODE !== 'browser',
  loader: () =>
    import.meta.env.MODE === 'browser'
      ? undefined
      : getComposeSnapshot({ data: 'upgrade' }),
  component: UpgradeApp,
})

function UpgradeApp(): ReactNode {
  if (import.meta.env.MODE !== 'browser') {
    const snapshot = Route.useLoaderData()
    if (!snapshot) throw new Error('showcase: upgrade snapshot is missing')
    return (
      <DeployedApp app={upgradeApp} snapshot={snapshot}>
        <UpgradePage />
      </DeployedApp>
    )
  }
  return <BrowserUpgradeApp />
}
