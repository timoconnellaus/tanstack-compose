import type { HostileFixture } from './types'

export const spinsFixture: HostileFixture = {
  id: 'spins',
  label: 'Never yields',
  expected: 'Requires an isolating host (slice 7).',
  deployedExpected: 'exceeded the 250ms callTimeoutMs wall-clock limit',
  disabled: true,
  source: `
const setup: Setup = async () => {
  while (true) {}
}
export default setup
`.trim(),
  stubs: [],
}
