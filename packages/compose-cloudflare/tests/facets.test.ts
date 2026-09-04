import { env } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import type { FacetTestObject } from '../dev/facet-test-object'

const testObject = (name: string) =>
  (
    env as unknown as {
      FACET_TEST: DurableObjectNamespace<FacetTestObject>
    }
  ).FACET_TEST.getByName(name)

describe('the Durable Object facet host', () => {
  it('keeps storage over restarts and rewrites, then deletes it on removal', async () => {
    const object = testObject('storage-lifecycle')

    await expect(object.storageLifecycle()).resolves.toEqual([1, 2, 12, 10])
    await object.stopClient()
  })

  it('runs a scheduled export without a request in flight', async () => {
    const object = testObject('scheduled-export')
    await object.scheduleOnce()

    await vi.waitFor(
      async () => {
        expect(await object.events()).toEqual(['fired'])
      },
      { timeout: 3000 },
    )
    await object.stopClient()
  })

  it('runs a recurring schedule until it is cancelled', async () => {
    const object = testObject('recurring-schedule')
    await object.scheduleEvery()

    await vi.waitFor(
      async () => {
        expect(
          (await object.events()).filter((event) => event === 'tick').length,
        ).toBeGreaterThanOrEqual(2)
      },
      { timeout: 5000 },
    )
    await object.cancelRecurring()
    const afterCancel = await object.events()

    await new Promise((resolve) => setTimeout(resolve, 200))

    await expect(object.events()).resolves.toEqual(afterCancel)
    await object.stopClient()
  })

  it('keeps a schedule over restart and rewrite, then deletes it on removal', async () => {
    const object = testObject('schedule-lifecycle')
    await object.scheduleThroughRestartAndRewrite()

    await vi.waitFor(
      async () => {
        expect(await object.events()).toEqual(['survived'])
      },
      { timeout: 5000 },
    )
    await object.armSurvivor()
    await object.removeScheduled('survivor')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await expect(object.events()).resolves.toEqual(['survived'])
    await object.stopClient()
  })

  it("dispatches each instance's schedule in its own facet", async () => {
    const object = testObject('two-schedules')
    await object.schedulePair()

    await vi.waitFor(
      async () => {
        const events = await object.events()
        expect(events).toContain('left')
        expect(events).toContain('right')
      },
      { timeout: 5000 },
    )
    await object.removeScheduled('left')
    const before = await object.events()
    const left = before.filter((event) => event === 'left').length
    const right = before.filter((event) => event === 'right').length

    await new Promise((resolve) => setTimeout(resolve, 300))

    const after = await object.events()
    expect(after.filter((event) => event === 'left')).toHaveLength(left)
    expect(after.filter((event) => event === 'right').length).toBeGreaterThan(
      right,
    )
    await object.removeScheduled('right')
    await object.stopClient()
  })
})
