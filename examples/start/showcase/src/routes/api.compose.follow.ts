import { createFileRoute } from '@tanstack/react-router'
import { parseAppId } from '../compose-functions'

export const Route = createFileRoute('/api/compose/follow')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // The upgrade itself never reaches this route: the Worker entry hands
        // it straight to the tenant object (see src/server.ts).
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
          return new Response('upgrade required', { status: 426 })
        }
        const app = parseAppId(new URL(request.url).searchParams.get('app'))
        const { tenantForApp } = await import('../compose.server')
        return tenantForApp(app).fetch(request)
      },
    },
  },
})
