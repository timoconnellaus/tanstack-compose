import { createFileRoute } from '@tanstack/react-router'
import { AppFrame } from '../app/app-frame'
import { HostilePage } from '../app/hostile-page'
import { hostileApp } from '../apps'
import { getBrowserClient } from '../browser-clients'
import type { ReactNode } from 'react'

export const Route = createFileRoute('/hostile')({
  ssr: false,
  component: HostileApp,
})

/** The hostile app: its own client, plugin list and panel. */
function HostileApp(): ReactNode {
  return (
    <AppFrame app={hostileApp} client={getBrowserClient(hostileApp)}>
      <HostilePage />
    </AppFrame>
  )
}
