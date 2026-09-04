import { createFileRoute } from '@tanstack/react-router'
import { TablePage } from '../app/table-page'

export const Route = createFileRoute('/table')({
  ssr: false,
  component: TablePage,
})
