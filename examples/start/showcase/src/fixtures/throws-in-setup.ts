import type { HostileFixture } from './types'

export const throwsInSetupFixture: HostileFixture = {
  id: 'throws-in-setup',
  label: 'Throws in setup',
  expected: 'setup failed — setup exploded',
  source: `
const setup: Setup = () => {
  throw new Error('setup exploded')
}
export default setup
`.trim(),
  stubs: [],
}
