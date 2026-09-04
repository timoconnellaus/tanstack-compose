import { useInstances, usePluginList } from '@tanstack/react-compose'
import { pairAFixture, pairBFixture } from '../fixtures'
import { useComposeWriter } from './app-frame'
import type { ReactNode } from 'react'

/** Page 8: two written entries ordered by an exported context key. */
export function PairPage(): ReactNode {
  const writer = useComposeWriter()
  const entries = usePluginList()
  const instances = new Map(
    useInstances().map((instance) => [instance.id, instance]),
  )
  const hasA = entries.some((entry) => entry.id === pairAFixture.id)
  const hasB = entries.some((entry) => entry.id === pairBFixture.id)
  return (
    <section className="page" data-testid="pair-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Page 8 · pair</p>
          <h2>A provides what B needs</h2>
          <p>B waits on the key A exports, then follows A's lifecycle.</p>
        </div>
      </div>
      <div className="button-row">
        <button
          type="button"
          disabled={hasB}
          onClick={() => void writer.add(pairBFixture)}
        >
          Add B
        </button>
        <button
          type="button"
          disabled={hasA}
          onClick={() => void writer.add(pairAFixture)}
        >
          Add A
        </button>
        <button
          type="button"
          disabled={!hasA}
          onClick={() => void writer.remove(pairAFixture.id)}
        >
          Remove A
        </button>
      </div>
      <p data-testid="pair-a-status">
        A: {instances.get(pairAFixture.id)?.status ?? 'not added'}
      </p>
      <p data-testid="pair-b-status">
        B: {instances.get(pairBFixture.id)?.status ?? 'not added'}
      </p>
    </section>
  )
}
