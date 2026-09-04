import { env } from 'cloudflare:test'
import { createCloudflareHost } from '@tanstack/compose-cloudflare'
import type { Host } from '@tanstack/compose'
import type { CloudflareHostOptions } from '@tanstack/compose-cloudflare'

/**
 * The compatibility date the suite loads every Dynamic Worker under. It has to
 * be one the workerd bundled with this wrangler supports, which is a lower cap
 * than production's; keep it in step with `wrangler.jsonc`.
 */
const compatibilityDate = '2026-05-01'

/** The Worker Loader binding this Worker was given. */
const loader = (env as unknown as { LOADER: WorkerLoader }).LOADER

/** A host over the test Worker's loader, with the suite's defaults. */
export function testHost(overrides: Partial<CloudflareHostOptions> = {}): Host {
  return createCloudflareHost({ loader, compatibilityDate, ...overrides })
}
