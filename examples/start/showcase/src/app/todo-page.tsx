import {
  Slot,
  useClient,
  useContextKey,
  useInstances,
  usePluginList,
  useStore,
} from '@tanstack/react-compose'
import { useEffect, useMemo, useState } from 'react'
import {
  createTodoStore,
  itemCreateAction,
  itemValidateAction,
  listSortAction,
  todoActions,
  todosKey,
} from '../base'
import { requireTitleFixture, sortByDueFixture } from '../fixtures'
import { useAppOperations } from './app-frame'
import { useDeclareSlots } from './slots'
import type { Todo } from '../base'
import type { ReactNode } from 'react'

const messageOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : String(error)

/** Page 2: wrap base actions without changing the page or base handlers. */
export function TodoPage(): ReactNode {
  const client = useClient()
  const operations = useAppOperations()
  const remoteTodos = useContextKey(todosKey)
  const localTodos = useMemo(() => createTodoStore(), [])
  const todos = remoteTodos ?? localTodos
  const items = useStore(todos)
  const instances = useInstances()
  const entries = usePluginList()
  const [sorted, setSorted] = useState<Array<Todo>>([])
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [problem, setProblem] = useState<string>()
  const declared = useMemo(() => [todoActions], [])
  useDeclareSlots(declared)

  useEffect(() => {
    let current = true
    void client.dispatch(listSortAction, { items }).then((next) => {
      if (current) setSorted(next)
    })
    return () => {
      current = false
    }
  }, [client, instances, items])

  const addFixture = async (
    fixture: typeof sortByDueFixture | typeof requireTitleFixture,
  ): Promise<void> => {
    setProblem(undefined)
    try {
      await operations.add(fixture)
    } catch (error) {
      setProblem(messageOf(error))
    }
  }

  return (
    <section className="page" data-testid="todo-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Page 2 · change behavior</p>
          <h2>Todos</h2>
          <p>Validation, creation and rendering each dispatch a base action.</p>
        </div>
        <div className="fixture-buttons">
          <button
            type="button"
            disabled={entries.some((entry) => entry.id === sortByDueFixture.id)}
            onClick={() => void addFixture(sortByDueFixture)}
          >
            Add: sort by due date
          </button>
          <button
            type="button"
            disabled={entries.some(
              (entry) => entry.id === requireTitleFixture.id,
            )}
            onClick={() => void addFixture(requireTitleFixture)}
          >
            Add: block empty titles
          </button>
        </div>
      </div>

      <div className="slot-toolbar" aria-label="Todo actions">
        <Slot of={todoActions} />
      </div>

      <form
        className="todo-form"
        onSubmit={(event) => {
          event.preventDefault()
          setProblem(undefined)
          void (async () => {
            const input = { title, ...(due === '' ? {} : { due }) }
            try {
              await client.dispatch(itemValidateAction, input)
              const created = await client.dispatch(itemCreateAction, input)
              if (!remoteTodos) localTodos.add(created)
              setTitle('')
              setDue('')
            } catch (error) {
              setProblem(messageOf(error))
            }
          })()
        }}
      >
        <label>
          Title
          <input
            aria-label="Todo title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Due
          <input
            aria-label="Todo due date"
            type="date"
            value={due}
            onChange={(event) => setDue(event.target.value)}
          />
        </label>
        <button type="submit">Add todo</button>
      </form>
      {problem === undefined ? null : (
        <p className="error" role="alert">
          {problem}
        </p>
      )}

      <ol className="todo-list" data-testid="todo-list">
        {sorted.map((todo) => (
          <li data-testid="todo-item" key={todo.id}>
            <label>
              <input
                aria-label={`Complete ${todo.title || 'untitled todo'}`}
                type="checkbox"
                checked={todo.done}
                onChange={(event) =>
                  todos.update(todo.id, { done: event.target.checked })
                }
              />
              <span>{todo.title}</span>
            </label>
            <time>{todo.due ?? 'No due date'}</time>
            <button type="button" onClick={() => todos.remove(todo.id)}>
              Remove todo
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
