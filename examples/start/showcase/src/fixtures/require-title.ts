import { actionsStub } from '../base'
import type { ShowcaseFixture } from './types'

export const requireTitleSource = `
const setup: Setup = async ({ stubs }) => {
  await stubs.actions.wrap('item.validate', { before: 'requireTitle' })
}
export default setup

export function requireTitle(input: {
  title: string
  due?: string
}): { title: string; due?: string } {
  if (input.title.trim() === '') throw new Error('a todo needs a title')
  return input
}
`.trim()

/** Middleware that rejects an empty todo title before base validation. */
export const requireTitleFixture: ShowcaseFixture = {
  id: 'require-title',
  source: requireTitleSource,
  stubs: [actionsStub],
}
