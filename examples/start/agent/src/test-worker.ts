export { ComposeStubLoopback } from '@tanstack/compose-cloudflare'
export { AgentTenant } from './tenant'

export default { fetch: () => new Response('agent test worker') }
