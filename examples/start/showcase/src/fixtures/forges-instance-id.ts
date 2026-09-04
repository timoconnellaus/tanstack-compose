import { dataStub } from '../base'
import type { HostileFixture } from './types'

export const forgesInstanceIdFixture: HostileFixture = {
  id: 'forges-instance-id',
  label: 'Forges instance id',
  expected:
    'Claimed “table”; stubCallAction observed “forges-instance-id” from the closure.',
  call: 'observation',
  source: `
let observed: { claimedInstanceId: string; actualInstanceId: string }
const setup: Setup = async ({ stubs }) => {
  observed = await stubs.data.identity('table')
}
export default setup
export function observation() { return observed }
`.trim(),
  stubs: [dataStub],
}
