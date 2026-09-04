import { createAppClient } from './apps'
import type { ShowcaseApp } from './apps'
import type { Client } from '@tanstack/compose'

const clients = new Map<ShowcaseApp['id'], Client>()

/**
 * The browser's one client per app, created on first use and kept for the
 * session so navigating between pages neither restarts an app nor shares one.
 * Browser-only: every route is `ssr: false` in this slice.
 */
export function getBrowserClient(app: ShowcaseApp): Client {
  if (typeof window === 'undefined') {
    throw new Error('showcase: a browser client is created in the browser only')
  }
  let client = clients.get(app.id)
  if (client === undefined) {
    client = createAppClient(app)
    clients.set(app.id, client)
  }
  return client
}
