import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/compose/follow')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
          return new Response('upgrade required', { status: 426 })
        }
        return await (await import('../compose.server')).tenant().fetch(request)
      },
    },
  },
})
