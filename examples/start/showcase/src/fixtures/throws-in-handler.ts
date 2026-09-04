import type { HostileFixture } from './types'

export const throwsInHandlerFixture: HostileFixture = {
  id: 'throws-in-handler',
  label: 'Throws in handler (first call)',
  expected: 'call failed — handler exploded',
  call: 'run',
  source: `
const setup: Setup = () => undefined
export default setup

export function run(_input: undefined): never {
  throw new Error('handler exploded')
}
`.trim(),
  stubs: [],
}
