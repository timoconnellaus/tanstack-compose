import { useEffect, useState } from 'react'
import {
  currencyApp,
  digestApp,
  hostileApp,
  pairApp,
  tableApp,
  tenantsApp,
  todoApp,
  upgradeApp,
} from '../apps'
import { createAppClient, getBrowserClient } from '../browser-clients'
import { AppFrame } from './app-frame'
import { CurrencyPage } from './currency-page'
import { DigestPage } from './digest-page'
import { HostilePage } from './hostile-page'
import { PairPage } from './pair-page'
import { TablePage } from './table-page'
import { TenantPanel } from './tenants-page'
import { TodoPage } from './todo-page'
import { UpgradePage } from './upgrade-page'
import type { ReactNode } from 'react'

/** S1's in-process Table app, loaded only by `vite --mode browser`. */
export function BrowserTableApp(): ReactNode {
  return (
    <AppFrame app={tableApp} client={getBrowserClient(tableApp)}>
      <TablePage />
    </AppFrame>
  )
}

/** S1's in-process Todo app, loaded only by `vite --mode browser`. */
export function BrowserTodoApp(): ReactNode {
  return (
    <AppFrame app={todoApp} client={getBrowserClient(todoApp)}>
      <TodoPage />
    </AppFrame>
  )
}

/** S1's in-process hostile gallery, loaded only by browser development. */
export function BrowserHostileApp(): ReactNode {
  return (
    <AppFrame app={hostileApp} client={getBrowserClient(hostileApp)}>
      <HostilePage />
    </AppFrame>
  )
}

/** Browser-only in-process Digest app. */
export function BrowserDigestApp(): ReactNode {
  return (
    <AppFrame app={digestApp} client={getBrowserClient(digestApp)}>
      <DigestPage />
    </AppFrame>
  )
}

/** Browser-only oracle for the Pair dependency graph. */
export function BrowserPairApp(): ReactNode {
  return (
    <AppFrame app={pairApp} client={getBrowserClient(pairApp)}>
      <PairPage />
    </AppFrame>
  )
}

/** Browser-only in-process Currency app. */
export function BrowserCurrencyApp(): ReactNode {
  return (
    <AppFrame app={currencyApp} client={getBrowserClient(currencyApp)}>
      <CurrencyPage />
    </AppFrame>
  )
}

/** Browser-only page 6 with two independent in-process clients. */
export function BrowserTenantsApp(): ReactNode {
  const [left] = useState(() => createAppClient(tenantsApp))
  const [right] = useState(() => createAppClient(tenantsApp))
  useEffect(
    () => () => {
      void left.destroy()
      void right.destroy()
    },
    [left, right],
  )
  return (
    <div className="tenant-grid" data-testid="tenants-page">
      <AppFrame app={tenantsApp} client={left}>
        <TenantPanel label="A" value="alpha" />
      </AppFrame>
      <AppFrame app={tenantsApp} client={right}>
        <TenantPanel label="B" value="bravo" />
      </AppFrame>
    </div>
  )
}

/** Browser-only v1 view of Upgrade; switching bases is deployed-only. */
export function BrowserUpgradeApp(): ReactNode {
  return (
    <AppFrame app={upgradeApp} client={getBrowserClient(upgradeApp)}>
      <UpgradePage />
    </AppFrame>
  )
}
