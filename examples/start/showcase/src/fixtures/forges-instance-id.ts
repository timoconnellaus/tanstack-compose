import { dataStub } from '../base'
import type { HostileFixture } from './types'

export const forgesInstanceIdFixture: HostileFixture = {
  id: 'forges-instance-id',
  label: 'Forges instance id',
  expected:
    'Claimed “table”; stubCallAction observed “forges-instance-id” from the closure.',
  source: `
const setup: Setup = async ({ stubs }) => {
  await stubs.data({
    operation: 'rows',
    claimedInstanceId: 'table',
  })
}
export default setup
`.trim(),
  stubs: [dataStub],
}
