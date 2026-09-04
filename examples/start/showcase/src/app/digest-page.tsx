import { usePluginList } from '@tanstack/react-compose'
import { digestFixture } from '../fixtures'
import { useComposeWriter } from './app-frame'
import type { ReactNode } from 'react'

/** Page 4: scheduled model work persists and publishes without a request. */
export function DigestPage(): ReactNode {
  const writer = useComposeWriter()
  const entries = usePluginList()
  const present = entries.some((entry) => entry.id === digestFixture.id)
  return (
    <section className="page" data-testid="digest-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Page 4 · unattended work</p>
          <h2>Invoice digest</h2>
          <p>
            The plugin wakes itself, summarises the rows and stores the result.
          </p>
        </div>
        <button
          type="button"
          disabled={present}
          onClick={() => void writer.add(digestFixture)}
        >
          Add: scheduled digest
        </button>
      </div>
    </section>
  )
}
