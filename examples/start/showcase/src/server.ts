import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

export { ComposeStubLoopback } from '@tanstack/compose-cloudflare'
export { ShowcaseTenant } from './tenant'

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request)
  },
})
