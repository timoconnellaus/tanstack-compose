export { ComposeStubLoopback } from '@tanstack/compose-cloudflare'
export { ShowcaseTenant } from './tenant'

export default {
  fetch(): Response {
    return new Response('showcase worker test')
  },
}
