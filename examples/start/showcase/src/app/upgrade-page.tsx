import { useInstances, usePluginList } from '@tanstack/react-compose'
import { useState } from 'react'
import { sortByDueFixture, sortByDueV2Fixture } from '../fixtures'
import { switchComposeBase } from '../compose-functions'
import { useComposeWriter } from './app-frame'
import type { ReactNode } from 'react'

/** Page 7: re-check persisted source when generated base declarations change. */
export function UpgradePage(): ReactNode {
  const writer = useComposeWriter()
  const entries = usePluginList()
  const instances = useInstances()
  const [problem, setProblem] = useState<string>()
  const present = entries.some((entry) => entry.id === sortByDueFixture.id)
  const status = instances.find(
    (instance) => instance.id === sortByDueFixture.id,
  )

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    try {
      setProblem(undefined)
      await work()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className="page" data-testid="upgrade-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Page 7 · upgrade</p>
          <h2>Rename a base method</h2>
          <p>
            `data.rows` becomes `data.records`; persisted source is rechecked.
          </p>
        </div>
      </div>
      <div className="button-row">
        <button
          type="button"
          disabled={present}
          onClick={() => void run(() => writer.add(sortByDueFixture))}
        >
          Add v1 sort by due
        </button>
        <button
          type="button"
          disabled={!writer.deployed}
          onClick={() => void run(() => switchComposeBase({ data: 'v2' }))}
        >
          Use base v2
        </button>
        <button
          type="button"
          onClick={() => void run(() => writer.add(sortByDueV2Fixture))}
        >
          Replace with v2 source
        </button>
      </div>
      <dl>
        <dt>Status</dt>
        <dd>{status?.status ?? 'not added'}</dd>
        {status?.error === undefined ? null : (
          <>
            <dt>Diagnostic</dt>
            <dd className="error">
              {status.error instanceof Error
                ? status.error.message
                : String(status.error)}
            </dd>
          </>
        )}
      </dl>
      {problem === undefined ? null : <p className="error">{problem}</p>}
    </section>
  )
}
