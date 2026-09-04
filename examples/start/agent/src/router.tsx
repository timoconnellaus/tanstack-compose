import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

/** Create one TanStack Router for a Start request or browser session. */
export function getRouter() {
  return createRouter({ routeTree, defaultPreload: 'intent' })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
