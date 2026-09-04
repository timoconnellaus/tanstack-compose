import { createFileRoute } from '@tanstack/react-router'
import { DeployedApp } from '../app/deployed-app'
import { TenantPanel } from '../app/tenants-page'
import { tenantsApp } from '../apps'
import { getTenantSnapshots } from '../compose-functions'
import type { ReactNode } from 'react'
import { BrowserTenantsApp } from '#showcase-browser-pages'

export const Route = createFileRoute('/tenants')({
  ssr: import.meta.env.MODE !== 'browser',
  loader: () =>
    import.meta.env.MODE === 'browser' ? undefined : getTenantSnapshots(),
  component: TenantsPage,
})

function TenantsPage(): ReactNode {
  if (import.meta.env.MODE === 'browser') return <BrowserTenantsApp />
  const data = Route.useLoaderData()
  if (!data) throw new Error('showcase: tenant snapshots are missing')
  return (
    <div className="tenant-grid" data-testid="tenants-page">
      <DeployedApp
        app={tenantsApp}
        tenant={data.left.tenant}
        snapshot={data.left.snapshot}
      >
        <TenantPanel label="A" value="alpha" />
      </DeployedApp>
      <DeployedApp
        app={tenantsApp}
        tenant={data.right.tenant}
        snapshot={data.right.snapshot}
      >
        <TenantPanel label="B" value="bravo" />
      </DeployedApp>
    </div>
  )
}
