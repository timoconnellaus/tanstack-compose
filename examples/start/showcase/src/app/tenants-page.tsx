import { usePluginList } from '@tanstack/react-compose'
import { tenantStorageFixture } from '../fixtures'
import { useComposeWriter } from './app-frame'
import type { ReactNode } from 'react'

/** One of page 6's two clients, running the same base and fixture source. */
export function TenantPanel(properties: {
  label: string
  value: string
}): ReactNode {
  const writer = useComposeWriter()
  const entries = usePluginList()
  const present = entries.some((entry) => entry.id === tenantStorageFixture.id)
  return (
    <section
      className="page tenant-panel"
      data-testid={`tenant-${properties.label}`}
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">Tenant {properties.label}</p>
          <h2>Private client</h2>
        </div>
        <button
          type="button"
          disabled={present}
          onClick={() =>
            void writer.add({
              ...tenantStorageFixture,
              options: { value: properties.value },
            })
          }
        >
          Add to tenant {properties.label}
        </button>
      </div>
    </section>
  )
}
