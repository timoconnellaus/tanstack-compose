import { createFileRoute } from '@tanstack/react-router'
import { DeployedApp } from '../app/deployed-app'
import { DigestPage } from '../app/digest-page'
import { digestApp } from '../apps'
import { getComposeSnapshot } from '../compose-functions'
import type { ReactNode } from 'react'
import { BrowserDigestApp } from '#showcase-browser-pages'

export const Route = createFileRoute('/digest')({
  ssr: import.meta.env.MODE !== 'browser',
  loader: () =>
    import.meta.env.MODE === 'browser'
      ? undefined
      : getComposeSnapshot({ data: 'digest' }),
  component: DigestApp,
})

function DigestApp(): ReactNode {
  if (import.meta.env.MODE !== 'browser') {
    const snapshot = Route.useLoaderData()
    if (!snapshot) throw new Error('showcase: digest snapshot is missing')
    return (
      <DeployedApp app={digestApp} snapshot={snapshot}>
        <DigestPage />
      </DeployedApp>
    )
  }
  return <BrowserDigestApp />
}
