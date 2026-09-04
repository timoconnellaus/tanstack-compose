export { ComposeStubLoopback } from '@tanstack/compose-cloudflare'
export { ShowcaseTenant } from './tenant'
export { CurrencyService } from './services/currency'

export default {
  fetch(): Response {
    return new Response('showcase worker test')
  },
}
