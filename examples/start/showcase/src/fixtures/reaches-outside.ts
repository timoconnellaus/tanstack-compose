import type { HostileFixture } from './types'

export const reachesOutsideFixture: HostileFixture = {
  id: 'reaches-outside',
  label: 'Reaches fetch, document and globalThis',
  expected: 'Requires an isolating host (slice 7).',
  disabled: true,
  source: `
const reach = Function(
  'return [typeof fetch, typeof document, typeof globalThis]'
)

const setup: Setup = () => {
  reach()
}
export default setup
`.trim(),
  stubs: [],
}
