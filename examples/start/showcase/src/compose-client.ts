import { createClient } from '@tanstack/compose'
import { createTypeScriptChecker } from '@tanstack/compose-typescript'
import { slotsPlugin, viewsPlugin } from '@tanstack/react-compose'
import { createClientOnlyFn } from '@tanstack/react-start'
import { tablePlugin, todoPlugin } from './base'
import type { Client } from '@tanstack/compose'

/** Create the one browser-client shape used by the app and by its tests. */
export function createShowcaseClient(): Client {
  return createClient({
    checker: createTypeScriptChecker(),
    plugins: [
      { id: 'slots', plugin: slotsPlugin },
      { id: 'views', plugin: viewsPlugin },
      { id: 'table', plugin: tablePlugin },
      { id: 'todo', plugin: todoPlugin },
    ],
  })
}

let browserClient: Client | undefined

/** The browser's single client, created lazily on the client-only root route. */
export const getBrowserClient = createClientOnlyFn((): Client => {
  browserClient ??= createShowcaseClient()
  return browserClient
})
