import { createFileRoute } from '@tanstack/react-router'
import { DeployedAgent } from '../app/deployed-app'
import { getComposeSnapshot } from '../compose-functions'
import type { ReactNode } from 'react'

export const Route = createFileRoute('/')({
  loader: () => getComposeSnapshot(),
  component: AgentPage,
})

function AgentPage(): ReactNode {
  return <DeployedAgent snapshot={Route.useLoaderData()} />
}
