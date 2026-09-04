import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

export { ComposeStubLoopback } from '@tanstack/compose-cloudflare'
export { ShowcaseTenant } from './tenant'

const followPath = '/api/compose/follow'

export default createServerEntry({
  async fetch(request) {
    if (
      new URL(request.url).pathname === followPath &&
      request.headers.get('upgrade')?.toLowerCase() === 'websocket'
    ) {
      const { followTenant } = await import('./compose.server')
      return await followTenant(request)
    }
    return handler.fetch(request)
  },
})
