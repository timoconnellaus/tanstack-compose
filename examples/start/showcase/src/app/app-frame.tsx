import { ComposeProvider, Slot } from '@tanstack/react-compose'
import { useComposeEdit, useComposeSnapshot } from '@tanstack/start-compose'
import { Suspense, createContext, useContext, useMemo } from 'react'
import { notifications, pageSide } from '../base'
import { PluginPanel } from './plugin-panel'
import { useDeclareSlots } from './slots'
import {
  addWritten,
  removeWritten,
  serializedEntriesForWritten,
} from '../written'
import type { ShowcaseApp } from '../apps'
import type { Client } from '@tanstack/compose'
import type { ShowcaseFixture } from '../fixtures'
import type { ReactNode } from 'react'

const AppContext = createContext<ShowcaseApp | undefined>(undefined)

interface ComposeWriter {
  deployed: boolean
  add: (fixture: ShowcaseFixture) => Promise<void>
  remove: (id: string) => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  revert: (keep: ReadonlySet<string>) => Promise<void>
}

const WriterContext = createContext<ComposeWriter | undefined>(undefined)

/** The app the current page belongs to. */
export function useApp(): ShowcaseApp {
  const app = useContext(AppContext)
  if (app === undefined) {
    throw new Error('showcase: useApp() needs an <AppFrame> above it')
  }
  return app
}

/** The edit path shared by both deployed and browser-only shapes. */
export function useComposeWriter(): ComposeWriter {
  const writer = useContext(WriterContext)
  if (!writer) throw new Error('showcase: no compose writer provider')
  return writer
}

/**
 * One app on the page: its client, its notifications, its page and its own
 * plugin panel. Nothing here outlives the route that renders it.
 */
export function AppFrame(properties: {
  app: ShowcaseApp
  client?: Client
  children: ReactNode
}): ReactNode {
  if (properties.client) {
    return (
      <ComposeProvider client={properties.client}>
        <DirectOperations app={properties.app} client={properties.client}>
          {properties.children}
        </DirectOperations>
      </ComposeProvider>
    )
  }
  return (
    <FollowerOperations app={properties.app}>
      {properties.children}
    </FollowerOperations>
  )
}

function DirectOperations(properties: {
  app: ShowcaseApp
  client: Client
  children: ReactNode
}): ReactNode {
  const writer = useMemo<ComposeWriter>(
    () => ({
      deployed: false,
      add: (fixture) => addWritten(properties.client, fixture, properties.app),
      remove: (id) => removeWritten(properties.client, id),
      setEnabled: (id, enabled) => properties.client.setEnabled(id, enabled),
      revert: async (keep) => {
        await properties.client.setPluginList(
          properties.client.pluginList.state.filter((entry) =>
            keep.has(entry.id),
          ),
        )
      },
    }),
    [properties.app, properties.client],
  )
  return (
    <WriterContext value={writer}>
      <Frame app={properties.app}>{properties.children}</Frame>
    </WriterContext>
  )
}

function FollowerOperations(properties: {
  app: ShowcaseApp
  children: ReactNode
}): ReactNode {
  const edit = useComposeEdit()
  const snapshot = useComposeSnapshot()
  const writer = useMemo<ComposeWriter>(
    () => ({
      deployed: true,
      add: async (fixture) => {
        for (const entry of serializedEntriesForWritten(
          fixture,
          properties.app,
        )) {
          await edit({ type: 'write', entry })
        }
      },
      remove: async (id) => {
        const server = id.endsWith('.view') ? id.slice(0, -5) : id
        await edit({ type: 'remove', id: server })
        await edit({ type: 'remove', id: `${server}.view` })
      },
      setEnabled: async (id, enabled) => {
        await edit({ type: 'enable', id, enabled })
      },
      revert: async (keep) => {
        for (const entry of snapshot.pluginList) {
          if (!keep.has(entry.id)) await edit({ type: 'remove', id: entry.id })
        }
      },
    }),
    [edit, properties.app, snapshot.pluginList],
  )
  return (
    <WriterContext value={writer}>
      <Frame app={properties.app}>{properties.children}</Frame>
    </WriterContext>
  )
}

function Frame(properties: {
  app: ShowcaseApp
  children: ReactNode
}): ReactNode {
  return (
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
      </div>
    </AppContext>
  )
}

/** Declare the frame's own slots on this app's client while it is mounted. */
function FrameSlots(): null {
  const declared = useMemo(() => [notifications, pageSide], [])
  useDeclareSlots(declared)
  return null
}
