import {
  createAction,
  createContextKey,
  createPlugin,
  createStub,
} from '@tanstack/compose'
import { createSlot, serverStub, slotsStub } from '@tanstack/react-compose'
import { Store } from '@tanstack/store'
import type {
  ActionDefinition,
  AnyAction,
  AnyStubGrant,
  Cleanup,
  ContextKey,
} from '@tanstack/compose'

/** One row in the table page's fixed demo dataset. */
export interface Row {
  id: number
  name: string
  city: string
  amount: number
  due: string
}

/** The table data held by ordinary base code. */
export interface TableData {
  readonly rows: ReadonlyArray<Row>
  /** Subscribe to future row changes; S1's fixed dataset never emits one. */
  subscribe: (listener: (rows: ReadonlyArray<Row>) => void) => Cleanup
}

/** One item in the todo page's store. */
export interface Todo {
  id: string
  title: string
  due?: string
  done: boolean
}

/** The observable todo store plus the ordinary mutations the base owns. */
export type TodoStore = Store<Array<Todo>> & {
  add: (todo: Todo) => void
  update: (id: string, patch: Partial<Omit<Todo, 'id'>>) => void
  remove: (id: string) => void
}

/** The table data context key. */
export const tableKey: ContextKey<TableData> =
  createContextKey<TableData>('showcase.table')

/** The todo store context key. */
export const todosKey: ContextKey<TodoStore> =
  createContextKey<TodoStore>('showcase.todos')

/** Sort the todo items before the page renders them. */
export const listSortAction: ActionDefinition<
  { items: Array<Todo> },
  Array<Todo>
> = createAction<{ items: Array<Todo> }, Array<Todo>>('list.sort')

/** Reject an invalid todo input by throwing. */
export const itemValidateAction: ActionDefinition<
  { title: string; due?: string },
  void
> = createAction<{ title: string; due?: string }, void>('item.validate')

/** Create a todo in the base store. */
export const itemCreateAction: ActionDefinition<
  { title: string; due?: string },
  Todo
> = createAction<{ title: string; due?: string }, Todo>('item.create')

/** Export table data in a format the base supports. */
export const tableExportAction: ActionDefinition<{ format: 'csv' }, string> =
  createAction<{ format: 'csv' }, string>('table.export')

/** Toolbar fills above the table. */
export const tableActions = createSlot<{ rows: ReadonlyArray<Row> }>(
  'table.actions',
)

/** Toolbar fills above the todo list. */
export const todoActions = createSlot('todo.actions')

/** Shell notifications shown in the header. */
export const notifications = createSlot('notifications')

/** Optional content beside a page. */
export const pageSide = createSlot('page.side')

const rowDeclaration = `
interface TableRow {
  id: number
  name: string
  city: string
  amount: number
  due: string
}
`.trim()

interface DataRequest {
  operation: string
  /** Used by hostile fixtures; the grant ignores non-operation fields. */
  payload?: unknown
  claimedInstanceId?: string
}

/** Read the table rows through one named grant. */
export const dataStub = createStub<DataRequest, Array<Row>>({
  name: 'data',
  declarations: `${rowDeclaration}

/** Read table data granted to this entry. */
declare const data: (request: {
  operation: 'rows'
  payload?: unknown
  claimedInstanceId?: string
}) => Promise<Array<TableRow>>`,
  deps: [tableKey],
  handler: ({ input, instance }) => {
    if (input.operation !== 'rows') {
      throw new Error('@showcase/data: only the rows operation is granted')
    }
    return [...instance.context.get(tableKey).rows]
  },
})

/** The actions hosted source may wrap. */
export type GrantableActionName = 'list.sort' | 'item.validate' | 'item.create'

interface ActionWrapRequest {
  operation: string
  action: string
  before?: string
  after?: string
}

/** The allow-list behind the actions grant. */
export const grantableActions: Readonly<
  Record<GrantableActionName, AnyAction>
> = {
  'list.sort': listSortAction,
  'item.validate': itemValidateAction,
  'item.create': itemCreateAction,
}

const isGrantableAction = (name: string): name is GrantableActionName =>
  name === 'list.sort' || name === 'item.validate' || name === 'item.create'

/** Wrap one explicitly granted base action with exports of the hosted source. */
export const actionsStub = createStub<ActionWrapRequest, void>({
  name: 'actions',
  declarations: `
interface TodoItem {
  id: string
  title: string
  due?: string
  done: boolean
}

type GrantableAction = 'list.sort' | 'item.validate' | 'item.create'

/** Register middleware owned by this hosted instance. */
declare const actions: (request: {
  operation: 'wrap'
  action: GrantableAction
  before?: string
  after?: string
}) => Promise<void>
`.trim(),
  handler: ({ input, instance, call }) => {
    if (input.operation !== 'wrap') {
      throw new Error('@showcase/actions: only the wrap operation is granted')
    }
    if (!isGrantableAction(input.action)) {
      throw new Error(
        `@showcase/actions: the action "${String(input.action)}" is not granted`,
      )
    }
    const action = grantableActions[input.action]
    instance.use<unknown, unknown>(action, async ({ input: given, next }) => {
      const prepared =
        input.before === undefined ? given : await call(input.before, given)
      const result = await next(prepared)
      return input.after === undefined ? result : call(input.after, result)
    })
  },
})

/** The two UI grants moved to `@tanstack/react-compose`. */
export { serverStub, slotsStub }

/** Every grant the paste panel can assign to a server-half entry. */
export const grantsByName: Readonly<Partial<Record<string, AnyStubGrant>>> = {
  data: dataStub,
  actions: actionsStub,
  slots: slotsStub,
  server: serverStub,
}

/** Stable table rows used by the page and fixture tests. */
export const demoRows: ReadonlyArray<Row> = [
  {
    id: 1,
    name: 'Avery Stone',
    city: 'Sydney',
    amount: 125,
    due: '2026-09-05',
  },
  {
    id: 2,
    name: 'Blair Chen',
    city: 'Melbourne',
    amount: 88.5,
    due: '2026-09-06',
  },
  {
    id: 3,
    name: 'Casey Singh',
    city: 'Brisbane',
    amount: 240,
    due: '2026-09-07',
  },
  { id: 4, name: 'Devon Brooks', city: 'Perth', amount: 64, due: '2026-09-08' },
  {
    id: 5,
    name: 'Emery Wilson',
    city: 'Adelaide',
    amount: 173.25,
    due: '2026-09-09',
  },
  { id: 6, name: 'Finley Park', city: 'Hobart', amount: 92, due: '2026-09-10' },
  {
    id: 7,
    name: 'Gray Martin',
    city: 'Darwin',
    amount: 310,
    due: '2026-09-11',
  },
  {
    id: 8,
    name: 'Harper Evans',
    city: 'Canberra',
    amount: 54.75,
    due: '2026-09-12',
  },
  {
    id: 9,
    name: 'Indigo King',
    city: 'Newcastle',
    amount: 198,
    due: '2026-09-13',
  },
  {
    id: 10,
    name: 'Jordan Lee',
    city: 'Geelong',
    amount: 145.5,
    due: '2026-09-14',
  },
  {
    id: 11,
    name: 'Kai Morgan',
    city: 'Wollongong',
    amount: 76,
    due: '2026-09-15',
  },
  {
    id: 12,
    name: 'Lane Taylor',
    city: 'Cairns',
    amount: 221,
    due: '2026-09-16',
  },
  {
    id: 13,
    name: 'Morgan Diaz',
    city: 'Townsville',
    amount: 109.9,
    due: '2026-09-17',
  },
  {
    id: 14,
    name: 'Noel Harris',
    city: 'Toowoomba',
    amount: 187,
    due: '2026-09-18',
  },
  {
    id: 15,
    name: 'Oakley Young',
    city: 'Ballarat',
    amount: 69,
    due: '2026-09-19',
  },
  {
    id: 16,
    name: 'Parker Hall',
    city: 'Bendigo',
    amount: 255.25,
    due: '2026-09-20',
  },
  {
    id: 17,
    name: 'Quinn Allen',
    city: 'Launceston',
    amount: 118,
    due: '2026-09-21',
  },
  {
    id: 18,
    name: 'Riley Scott',
    city: 'Mackay',
    amount: 96.5,
    due: '2026-09-22',
  },
  {
    id: 19,
    name: 'Sage Green',
    city: 'Rockhampton',
    amount: 205,
    due: '2026-09-23',
  },
  {
    id: 20,
    name: 'Taylor Adams',
    city: 'Bundaberg',
    amount: 81.75,
    due: '2026-09-24',
  },
  { id: 21, name: 'Uma Bell', city: 'Albury', amount: 132, due: '2026-09-25' },
  {
    id: 22,
    name: 'Vale Baker',
    city: 'Wagga Wagga',
    amount: 278,
    due: '2026-09-26',
  },
  {
    id: 23,
    name: 'Winter Clark',
    city: 'Mildura',
    amount: 57.5,
    due: '2026-09-27',
  },
  {
    id: 24,
    name: 'Xan Cooper',
    city: 'Tamworth',
    amount: 164,
    due: '2026-09-28',
  },
  {
    id: 25,
    name: 'Yael Nelson',
    city: 'Orange',
    amount: 113.25,
    due: '2026-09-29',
  },
  {
    id: 26,
    name: 'Zion Carter',
    city: 'Dubbo',
    amount: 230,
    due: '2026-09-30',
  },
  {
    id: 27,
    name: 'Arden Mitchell',
    city: 'Geraldton',
    amount: 74,
    due: '2026-10-01',
  },
  {
    id: 28,
    name: 'Billie Roberts',
    city: 'Broome',
    amount: 191.5,
    due: '2026-10-02',
  },
  {
    id: 29,
    name: 'Cameron Turner',
    city: 'Albany',
    amount: 102,
    due: '2026-10-03',
  },
  {
    id: 30,
    name: 'Drew Phillips',
    city: 'Esperance',
    amount: 266.75,
    due: '2026-10-04',
  },
]

const csvCell = (value: string | number): string =>
  `"${String(value).replaceAll('"', '""')}"`

/** The trusted table plugin holding the dataset and default CSV action. */
export const tablePlugin = createPlugin({
  name: 'table',
  provides: [tableKey],
  setup(instance) {
    const table: TableData = {
      rows: demoRows,
      subscribe: (_listener) => () => undefined,
    }
    instance.provide(tableKey, table)
    instance.defineAction(tableExportAction, () => {
      return [
        'id,name,city,amount,due',
        ...table.rows.map((row) =>
          [row.id, row.name, row.city, row.amount, row.due]
            .map(csvCell)
            .join(','),
        ),
      ].join('\n')
    })
  },
})

const initialTodos: Array<Todo> = [
  { id: 'todo-1', title: 'Book dentist', due: '2026-09-10', done: false },
  { id: 'todo-2', title: 'Call Alice', done: false },
  { id: 'todo-3', title: 'Write report', due: '2026-09-05', done: false },
]

/** The trusted todo plugin holding state and the default action handlers. */
export const todoPlugin = createPlugin({
  name: 'todo',
  provides: [todosKey],
  setup(instance) {
    const store = new Store<Array<Todo>>(
      initialTodos.map((todo) => ({ ...todo })),
    )
    let nextId = initialTodos.length + 1
    const todos: TodoStore = Object.assign(store, {
      add: (todo: Todo) => store.setState((items) => [...items, todo]),
      update: (id: string, patch: Partial<Omit<Todo, 'id'>>) =>
        store.setState((items) =>
          items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        ),
      remove: (id: string) =>
        store.setState((items) => items.filter((item) => item.id !== id)),
    })
    instance.provide(todosKey, todos)
    instance.defineAction(listSortAction, ({ items }) =>
      [...items].sort((left, right) => left.title.localeCompare(right.title)),
    )
    instance.defineAction(itemValidateAction, () => undefined)
    instance.defineAction(itemCreateAction, (input) => {
      const todo: Todo = {
        id: `todo-${nextId}`,
        title: input.title,
        ...(input.due === undefined || input.due === ''
          ? {}
          : { due: input.due }),
        done: false,
      }
      nextId += 1
      todos.add(todo)
      return todo
    })
  },
})
