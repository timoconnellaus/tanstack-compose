import { actionsStub } from '../base'
import type { ShowcaseFixture } from './types'

export const sortByDueSource = `
const setup: Setup = async ({ stubs }) => {
  await stubs.actions({
    operation: 'wrap',
    action: 'list.sort',
    after: 'byDue',
  })
}
export default setup

export function byDue(items: Array<TodoItem>): Array<TodoItem> {
  return [...items].sort((left, right) => {
    const due = (left.due ?? '\\uffff').localeCompare(right.due ?? '\\uffff')
    return due === 0 ? left.title.localeCompare(right.title) : due
  })
}
`.trim()

/** Middleware that replaces the base title order with due-date order. */
export const sortByDueFixture: ShowcaseFixture = {
  id: 'sort-by-due',
  source: sortByDueSource,
  stubs: [actionsStub],
}
