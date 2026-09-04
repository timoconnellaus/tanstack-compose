import { Navigate, createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export const Route = createFileRoute('/')({
  ssr: false,
  component: IndexPage,
})

function IndexPage(): ReactNode {
  return <Navigate to="/table" replace />
}
