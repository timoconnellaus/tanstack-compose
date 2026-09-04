import { dataStub } from '../base'
import type { HostileFixture } from './types'

export const oversizedPayloadFixture: HostileFixture = {
  id: 'oversized-payload',
  label: 'Oversized payload (50 MB)',
  expected:
    'The in-process host has no transfer limit; refusal is proven by the isolating host in slice 7.',
  source: `
const setup: Setup = async ({ stubs }) => {
  await stubs.data({
    operation: 'rows',
    payload: 'x'.repeat(50 * 1024 * 1024),
  })
}
export default setup
`.trim(),
  stubs: [dataStub],
}
