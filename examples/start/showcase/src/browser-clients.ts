import { createClient, createInProcessHost } from '@tanstack/compose'
import { createInProcessGrants } from '@tanstack/compose/grants'
import { createTypeScriptChecker } from '@tanstack/compose-typescript'
import { currencyHandler } from './services/currency-handler'
import declarations from 'compose:declarations'
import type { ShowcaseApp } from './apps'
import type { Client } from '@tanstack/compose'

const clients = new Map<ShowcaseApp['id'], Client>()

/** A fresh in-process client for S1 tests and `dev:browser` only. */
export function createAppClient(app: ShowcaseApp): Client {
  return createClient({
    baseVersion: declarations.version,
    checker: createTypeScriptChecker({
      baseDeclarations: declarations.text,
      baseVersion: declarations.version,
    }),
    hosts: {
      'in-process': createInProcessHost({
        grants: createInProcessGrants({
          services: {
            currency: {
              origin: 'https://currency.showcase.test',
              credential: {
                header: 'authorization',
                value: 'Bearer server-owned',
              },
            },
          },
          respond: ({ prompt }) => `Echo: ${prompt}`,
          fetch: (input, init) =>
            Promise.resolve(
              currencyHandler(new Request(input, init), 'Bearer server-owned'),
            ),
        }),
      }),
    },
    plugins: [...app.plugins],
  })
}

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
