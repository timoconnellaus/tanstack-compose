import { dataStub } from '../base'
import type { HostileFixture } from './types'

export const smugglesAFunctionFixture: HostileFixture = {
  id: 'smuggles-a-function',
  label: 'Smuggles a function',
  expected: 'is not structured-clone-safe',
  source: `
const setup: Setup = async ({ stubs }) => {
  await stubs.data({
    operation: 'rows',
    payload: () => 'not plain data',
  })
}
export default setup
`.trim(),
  stubs: [dataStub],
}
