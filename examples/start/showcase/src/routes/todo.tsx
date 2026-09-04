import { createFileRoute } from '@tanstack/react-router'
import { DeployedApp } from '../app/deployed-app'
import { BrowserTodoApp } from '#showcase-browser-pages'
import { TodoPage } from '../app/todo-page'
import { todoApp } from '../apps'
import { getComposeSnapshot } from '../compose-functions'
import type { ReactNode } from 'react'

export const Route = createFileRoute('/todo')({
  ssr: import.meta.env.MODE !== 'browser',
  loader: () =>
    import.meta.env.MODE === 'browser'
      ? undefined
      : getComposeSnapshot({ data: 'todo' }),
  component: TodoApp,
})

/** The todo app: its own client, plugin list and panel. */
function TodoApp(): ReactNode {
  if (import.meta.env.MODE !== 'browser') {
    const snapshot = Route.useLoaderData()
    if (!snapshot) throw new Error('showcase: todo snapshot is missing')
    return (
      <DeployedApp app={todoApp} snapshot={snapshot}>
        <TodoPage />
      </DeployedApp>
    )
  }
  return <BrowserTodoApp />
}
