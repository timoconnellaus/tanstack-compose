import { createFileRoute } from '@tanstack/react-router'
import { AppFrame } from '../app/app-frame'
import { TodoPage } from '../app/todo-page'
import { todoApp } from '../apps'
import { getBrowserClient } from '../browser-clients'
import type { ReactNode } from 'react'

export const Route = createFileRoute('/todo')({
  ssr: false,
  component: TodoApp,
})

/** The todo app: its own client, plugin list and panel. */
function TodoApp(): ReactNode {
  return (
    <AppFrame app={todoApp} client={getBrowserClient(todoApp)}>
      <TodoPage />
    </AppFrame>
  )
}
