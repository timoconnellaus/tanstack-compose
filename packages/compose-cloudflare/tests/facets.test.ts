import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
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

    await new Promise((resolve) => setTimeout(resolve, 100))

    await expect(object.events()).resolves.toEqual(['fired'])
    await object.stopClient()
  })
})
