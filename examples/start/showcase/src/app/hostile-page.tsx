import { stubCallAction } from '@tanstack/compose'
import {
  isClient,
  useComposeView,
  useInstances,
  usePluginList,
} from '@tanstack/react-compose'
import { useEffect, useState } from 'react'
import { hostileFixtures } from '../fixtures'
import { useComposeWriter } from './app-frame'
import type { HostileFixture } from '../fixtures'
import type { ReactNode } from 'react'

const messageOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : String(error)

/** Page 3: show exactly what the in-process host does and does not enforce. */
export function HostilePage(): ReactNode {
  const view = useComposeView()
  const writer = useComposeWriter()
  const entries = usePluginList()
  const instances = useInstances()
  const [observed, setObserved] = useState<ReadonlyMap<string, string>>(
    new Map(),
  )
  const [lastGoodIds, setLastGoodIds] = useState<ReadonlySet<string>>(
    new Set(view.pluginList.state.map((entry) => entry.id)),
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
      setLastGoodIds(new Set(entries.map((entry) => entry.id)))
    }
  }, [entries, instances])

  const add = async (fixture: HostileFixture): Promise<void> => {
    let actualId: string | undefined
    let claimedId: string | undefined
    const unobserve = isClient(view)
      ? view.use(stubCallAction, async ({ input, next }) => {
          if (input.instanceId === fixture.id) {
            actualId = input.instanceId
            const payload = input.input as {
              claimedInstanceId?: unknown
            } | null
            if (typeof payload?.claimedInstanceId === 'string') {
              claimedId = payload.claimedInstanceId
            }
          }
          return next(input)
        })
      : () => undefined
    try {
      await writer.add(fixture)
      let result: unknown
      if (fixture.call !== undefined) {
        try {
          if (!view.callSource) {
            throw new Error('showcase: this ComposeView cannot call source')
          }
          result = await view.callSource(fixture.id, fixture.call)
        } catch {
          // The instance status and attached SourceError are the proof.
        }
      }
      if (fixture.id === 'forges-instance-id') {
        const identity = result as
          { claimedInstanceId?: string; actualInstanceId?: string } | undefined
        setObserved((current) =>
          new Map(current).set(
            fixture.id,
            `Claimed “${identity?.claimedInstanceId ?? claimedId ?? 'unseen'}”; stubCallAction observed “${identity?.actualInstanceId ?? actualId ?? 'unseen'}” from the closure.`,
          ),
        )
      } else if (fixture.id === 'oversized-payload') {
        setObserved((current) =>
          new Map(current).set(
            fixture.id,
            writer.deployed
              ? (fixture.deployedExpected ?? fixture.expected)
              : fixture.expected,
          ),
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
          <p>These are real source entries running beside the server client.</p>
        </div>
        <button type="button" onClick={() => void writer.revert(lastGoodIds)}>
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
              <p>
                {writer.deployed
                  ? (fixture.deployedExpected ?? fixture.expected)
                  : fixture.expected}
              </p>
              <button
                type="button"
                disabled={
                  (fixture.disabled === true && !writer.deployed) || present
                }
                onClick={() => void add(fixture)}
              >
                {fixture.disabled && !writer.deployed
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
