import { env } from 'cloudflare:test'
import { createCloudflareHost } from '../../src/index'
import type { Host } from '@tanstack/compose'
import type { CloudflareHostOptions } from '../../src/index'

/**
 * The compatibility date the suite loads every Dynamic Worker under. It has to
 * be one the workerd bundled with this wrangler supports, which is a lower cap
 * than production's; keep it in step with `wrangler.jsonc`.
 */
export const compatibilityDate = '2026-05-01'

/** The Worker Loader binding this Worker was given. */
const loader = (env as unknown as { LOADER: WorkerLoader }).LOADER

/** A host over the test Worker's loader, with the suite's defaults. */
export function testHost(overrides: Partial<CloudflareHostOptions> = {}): Host {
  return createCloudflareHost({ loader, compatibilityDate, ...overrides })
}

/** A loader that records the ids it is asked for and the loads it performs. */
export function countingLoader(): {
  loader: WorkerLoader
  ids: Array<string>
  loads: Array<string>
} {
  const ids: Array<string> = []
  const loads: Array<string> = []
  return {
    ids,
    loads,
    loader: {
      get(id, getCode) {
        ids.push(id as string)
        return loader.get(id, async () => {
          loads.push(id as string)
          return await getCode()
        })
      },
      load: (code) => loader.load(code),
    },
  }
}
