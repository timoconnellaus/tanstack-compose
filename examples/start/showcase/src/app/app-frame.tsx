import { ComposeProvider, Slot } from '@tanstack/react-compose'
import {
  TanStackDevtools,
  composeDevtoolsPlugin,
} from '@tanstack/compose-devtools/react'
import { Suspense, createContext, useContext, useMemo } from 'react'
import { notifications, pageSide } from '../base'
import { PluginPanel } from './plugin-panel'
import { useDeclareSlots } from './slots'
import type { ShowcaseApp } from '../apps'
import type { Client } from '@tanstack/compose'
import type { ReactNode } from 'react'

const AppContext = createContext<ShowcaseApp | undefined>(undefined)

/** The app the current page belongs to. */
export function useApp(): ShowcaseApp {
  const app = useContext(AppContext)
  if (app === undefined) {
    throw new Error('showcase: useApp() needs an <AppFrame> above it')
  }
  return app
}

/**
 * One app on the page: its client, its notifications, its page and its own
 * plugin panel. Nothing here outlives the route that renders it.
 */
export function AppFrame(properties: {
  app: ShowcaseApp
  client: Client
  children: ReactNode
}): ReactNode {
  return (
    <ComposeProvider client={properties.client}>
      <AppContext value={properties.app}>
        <FrameSlots />
        <div className="shell-grid" data-testid={`app-${properties.app.id}`}>
          <div className="page-content">
            <div className="notifications" aria-label="Notifications">
              <Slot of={notifications} />
            </div>
            <main>
              <Suspense fallback={<p>Starting {properties.app.title}…</p>}>
                {properties.children}
              </Suspense>
            </main>
            <Slot of={pageSide} />
          </div>
          <PluginPanel />
          {import.meta.env.DEV && !import.meta.env.TEST ? (
            <TanStackDevtools
              plugins={[composeDevtoolsPlugin(properties.client)]}
            />
          ) : null}
        </div>
      </AppContext>
    </ComposeProvider>
  )
}

/** Declare the frame's own slots on this app's client while it is mounted. */
function FrameSlots(): null {
  const declared = useMemo(() => [notifications, pageSide], [])
  useDeclareSlots(declared)
  return null
}
