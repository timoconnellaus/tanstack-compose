import { AppFrame } from './app-frame'
import { HostilePage } from './hostile-page'
import { TablePage } from './table-page'
import { TodoPage } from './todo-page'
import { hostileApp, tableApp, todoApp } from '../apps'
import { getBrowserClient } from '../browser-clients'
import type { ReactNode } from 'react'

/** S1's in-process Table app, loaded only by `vite --mode browser`. */
export function BrowserTableApp(): ReactNode {
  return (
    <AppFrame app={tableApp} client={getBrowserClient(tableApp)}>
      <TablePage />
    </AppFrame>
  )
}

/** S1's in-process Todo app, loaded only by `vite --mode browser`. */
export function BrowserTodoApp(): ReactNode {
  return (
    <AppFrame app={todoApp} client={getBrowserClient(todoApp)}>
      <TodoPage />
    </AppFrame>
  )
}

/** S1's in-process hostile gallery, loaded only by browser development. */
export function BrowserHostileApp(): ReactNode {
  return (
    <AppFrame app={hostileApp} client={getBrowserClient(hostileApp)}>
      <HostilePage />
    </AppFrame>
  )
}
