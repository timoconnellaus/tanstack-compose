import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

export { ComposeStubLoopback } from '@tanstack/compose-cloudflare'
export { AgentTenant } from './tenant'

const followPath = '/api/compose/follow'

export default createServerEntry({
  async fetch(request) {
    if (
      new URL(request.url).pathname === followPath &&
      request.headers.get('upgrade')?.toLowerCase() === 'websocket'
    ) {
      return await (await import('./compose.server')).followTenant(request)
    }
    return handler.fetch(request)
  },
})
