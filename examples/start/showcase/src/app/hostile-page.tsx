import { stubCallAction } from '@tanstack/compose'
import { useClient, useInstances, usePluginList } from '@tanstack/react-compose'
import { useEffect, useState } from 'react'
import { hostileFixtures } from '../fixtures'
import { addWritten } from '../written'
import type { PluginEntry } from '@tanstack/compose'
import type { HostileFixture } from '../fixtures'
import type { ReactNode } from 'react'

const messageOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : String(error)

/** Page 3: show exactly what the in-process host does and does not enforce. */
export function HostilePage(): ReactNode {
  const client = useClient()
  const entries = usePluginList()
  const instances = useInstances()
  const [lastGood, setLastGood] = useState<Array<PluginEntry>>(
    client.pluginList.state,
  )
  const [observed, setObserved] = useState<ReadonlyMap<string, string>>(
    new Map(),
  )

  useEffect(() => {
    const enabled = entries.filter((entry) => entry.enabled !== false)
    if (
      enabled.length === entries.length &&
      instances.length === enabled.length &&
      enabled.every(
        (entry) =>
          instances.find((instance) => instance.id === entry.id)?.status ===
          'active',
      )
    ) {
      setLastGood(entries)
    }
  }, [entries, instances])

  const add = async (fixture: HostileFixture): Promise<void> => {
    let actualId: string | undefined
    let claimedId: string | undefined
    const unobserve = client.use(stubCallAction, async ({ input, next }) => {
      if (input.instanceId === fixture.id) {
        actualId = input.instanceId
        const payload = input.input as { claimedInstanceId?: unknown } | null
        if (typeof payload?.claimedInstanceId === 'string') {
          claimedId = payload.claimedInstanceId
        }
      }
      return next(input)
    })
    try {
      await addWritten(client, fixture)
      if (fixture.call !== undefined) {
        try {
          await client.callSource(fixture.id, fixture.call)
        } catch {
          // The instance status and attached SourceError are the proof.
        }
      }
      if (fixture.id === 'forges-instance-id') {
        setObserved((current) =>
          new Map(current).set(
            fixture.id,
            `Claimed “${claimedId}”; stubCallAction observed “${actualId}” from the closure.`,
          ),
        )
      } else if (fixture.id === 'oversized-payload') {
        setObserved((current) =>
          new Map(current).set(fixture.id, fixture.expected),
        )
      }
    } finally {
      unobserve()
    }
  }

  const byId = new Map(instances.map((instance) => [instance.id, instance]))

  return (
    <section className="page" data-testid="hostile-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Page 3 · fail closed</p>
          <h2>Hostile gallery</h2>
          <p>
            These are real source entries. S1 reports the in-process host's
            limits without simulating isolation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void client.setPluginList(lastGood)}
        >
          Revert to last good
        </button>
      </div>

      <div className="hostile-grid">
        {hostileFixtures.map((fixture) => {
          const instance = byId.get(fixture.id)
          const present = entries.some((entry) => entry.id === fixture.id)
          return (
            <article data-testid={`hostile-${fixture.id}`} key={fixture.id}>
              <h3>{fixture.label}</h3>
              <p>{fixture.expected}</p>
              <button
                type="button"
                disabled={fixture.disabled === true || present}
                onClick={() => void add(fixture)}
              >
                {fixture.disabled
                  ? 'Requires isolating host'
                  : `Run: ${fixture.label}`}
              </button>
              <dl>
                <dt>Status</dt>
                <dd>{instance?.status ?? 'not added'}</dd>
                {instance?.error === undefined ? null : (
                  <>
                    <dt>Error</dt>
                    <dd className="error">{messageOf(instance.error)}</dd>
                  </>
                )}
              </dl>
              {observed.get(fixture.id) === undefined ? null : (
                <p data-testid={`hostile-result-${fixture.id}`}>
                  {observed.get(fixture.id)}
                </p>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
