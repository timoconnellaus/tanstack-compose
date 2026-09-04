import { createFileRoute } from '@tanstack/react-router'
import { TodoPage } from '../app/todo-page'

export const Route = createFileRoute('/todo')({
  ssr: false,
  component: TodoPage,
})
