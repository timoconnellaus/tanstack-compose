import { createFileRoute } from '@tanstack/react-router'
import { HostilePage } from '../app/hostile-page'

export const Route = createFileRoute('/hostile')({
  ssr: false,
  component: HostilePage,
})
