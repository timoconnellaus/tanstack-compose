import { depsStub } from '../base'
import type { ShowcaseFixture } from './types'

/** B's granted `deps` key keeps setup pending until A publishes it. */
export const pairBSource = `
let value = ''
const setup: Setup = async ({ stubs }) => {
  value = await stubs.deps.value()
}
export default setup

export function read(): string {
  return value
}
`.trim()

export const pairBFixture: ShowcaseFixture = {
  id: 'pair-b',
  source: pairBSource,
  stubs: [depsStub],
}
