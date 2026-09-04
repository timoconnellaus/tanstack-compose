import { createFileRoute } from '@tanstack/react-router'
import { parseAppId } from '../compose-functions'

export const Route = createFileRoute('/api/compose/follow')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const app = parseAppId(new URL(request.url).searchParams.get('app'))
        const { tenantForApp } = await import('../compose.server')
        return tenantForApp(app).follow()
      },
    },
  },
})
