import { createFileRoute } from '@tanstack/react-router'
import { CurrencyPage } from '../app/currency-page'
import { DeployedApp } from '../app/deployed-app'
import { currencyApp } from '../apps'
import { getComposeSnapshot } from '../compose-functions'
import type { ReactNode } from 'react'
import { BrowserCurrencyApp } from '#showcase-browser-pages'

export const Route = createFileRoute('/currency')({
  ssr: import.meta.env.MODE !== 'browser',
  loader: () =>
    import.meta.env.MODE === 'browser'
      ? undefined
      : getComposeSnapshot({ data: 'currency' }),
  component: CurrencyApp,
})

function CurrencyApp(): ReactNode {
  if (import.meta.env.MODE !== 'browser') {
    const snapshot = Route.useLoaderData()
    if (!snapshot) throw new Error('showcase: currency snapshot is missing')
    return (
      <DeployedApp app={currencyApp} snapshot={snapshot}>
        <CurrencyPage />
      </DeployedApp>
    )
  }
  return <BrowserCurrencyApp />
}
