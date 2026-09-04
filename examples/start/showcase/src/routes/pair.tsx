import { createFileRoute } from '@tanstack/react-router'
import { BrowserPairApp } from '#showcase-browser-pages'
import { DeployedApp } from '../app/deployed-app'
import { PairPage } from '../app/pair-page'
import { pairApp } from '../apps'
import { getComposeSnapshot } from '../compose-functions'
import type { ReactNode } from 'react'

export const Route = createFileRoute('/pair')({
  ssr: import.meta.env.MODE !== 'browser',
  loader: () =>
    import.meta.env.MODE === 'browser'
      ? undefined
      : getComposeSnapshot({ data: 'pair' }),
  component: PairApp,
})

function PairApp(): ReactNode {
  if (import.meta.env.MODE !== 'browser') {
    const snapshot = Route.useLoaderData()
    if (!snapshot) throw new Error('showcase: pair snapshot is missing')
    return (
      <DeployedApp app={pairApp} snapshot={snapshot}>
        <PairPage />
      </DeployedApp>
    )
  }
  return <BrowserPairApp />
}
