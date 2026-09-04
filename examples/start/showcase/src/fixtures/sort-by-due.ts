import { actionsStub, dataStub } from '../base'
import type { ShowcaseFixture } from './types'

export const sortByDueSource = `
interface TodoItem {
  id: string
  title: string
  due?: string
  done: boolean
}

const setup: Setup = async ({ stubs }) => {
  await stubs.data.rows()
  await stubs.actions.wrap('list.sort', { after: 'byDue' })
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
  stubs: [actionsStub, dataStub],
}
