import type { HostileFixture } from './types'

export const reachesOutsideFixture: HostileFixture = {
  id: 'reaches-outside',
  label: 'Reaches fetch, document and globalThis',
  expected: 'Requires an isolating host (slice 7).',
  deployedExpected:
    'Outbound fetch is disabled, env is never passed, and globalThis exposes no tenant bindings.',
  disabled: true,
  source: `
const reach = Function(
  "if ('env' in globalThis) throw new Error('tenant env leaked'); return fetch('https://example.com')"
)
const setup: Setup = async () => await reach()
export default setup
`.trim(),
  stubs: [],
}
