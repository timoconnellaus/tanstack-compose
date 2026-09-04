import { exportsStub } from '../base'
import type { ShowcaseFixture } from './types'

/** A publishes one value through the granted Pair context key. */
export const pairASource = `
const setup: Setup = async ({ stubs }) => {
  await stubs.exports.value('A is active')
}
export default setup
`.trim()

export const pairAFixture: ShowcaseFixture = {
  id: 'pair-a',
  source: pairASource,
  stubs: [exportsStub],
}
