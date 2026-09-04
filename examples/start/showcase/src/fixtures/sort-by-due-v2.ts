import { actionsStub } from '../base'
import { dataV2Stub } from '../base-v2'
import type { ShowcaseFixture } from './types'

/** The due-date plugin repaired for base v2's `data.records` method. */
export const sortByDueV2Source = `
interface TodoItem {
  id: string
  title: string
  due?: string
  done: boolean
}

const setup: Setup = async ({ stubs }) => {
  await stubs.data.records()
  await stubs.actions.wrap('list.sort', { after: 'byDue' })
}
export default setup

export function byDue(items: Array<TodoItem>): Array<TodoItem> {
  return [...items].sort((left, right) => {
    const due = (left.due ?? '\uffff').localeCompare(right.due ?? '\uffff')
    return due === 0 ? left.title.localeCompare(right.title) : due
  })
}
`.trim()

export const sortByDueV2Fixture: ShowcaseFixture = {
  id: 'sort-by-due',
  source: sortByDueV2Source,
  stubs: [actionsStub, dataV2Stub],
}
