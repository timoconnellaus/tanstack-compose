/** React adapter for the TanStack Compose devtools panel. */
import { useEffect, useMemo, useRef } from 'react'
import { useStore } from '@tanstack/react-store'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { mountComposePanel } from './solid-panel'
import { createDevtools } from './index'
import type { Client } from '@tanstack/compose'
import type { TanStackDevtoolsTheme } from '@tanstack/devtools-ui'
import type { TanStackDevtoolsReactPlugin } from '@tanstack/react-devtools'
import type { ReactNode } from 'react'
import type { MountedComposePanel } from './solid-panel'

/** Props for the React panel used by the TanStack Devtools plugin. */
export interface ComposeDevtoolsPanelProps {
  client: Client
  /** Supplied by the TanStack Devtools shell. */
  theme?: TanStackDevtoolsTheme
}

/** Render a live TanStack Compose inspection panel. */
export function ComposeDevtoolsPanel({
  client,
  theme = 'dark',
}: ComposeDevtoolsPanelProps): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const mounted = useRef<MountedComposePanel>(null)
  const devtools = useMemo(() => createDevtools({ client }), [client])

  const pluginList = useStore(client.pluginList)
  const instances = useStore(client.instances)
  const context = useStore(client.context)
  const errors = useStore(client.errors)
  const snapshot = useMemo(
    () => devtools.snapshot(),
    [context, devtools, errors, instances, pluginList],
  )

  useEffect(() => () => devtools.close(), [devtools])

  useEffect(() => {
    const element = host.current
    if (!element) return
    const panel = mountComposePanel(element, devtools.snapshot(), theme)
    mounted.current = panel
    return () => {
      panel.close()
      mounted.current = null
    }
  }, [devtools, theme])

  useEffect(() => mounted.current?.update(snapshot, theme), [snapshot, theme])

  return <div data-testid="compose-devtools-panel" ref={host} />
}

/** Options for the Compose plugin in the TanStack Devtools shell. */
export interface ComposeDevtoolsPluginOptions {
  /** The tab name shown by TanStack Devtools. */
  name?: string
}

/** Create the React plugin consumed by `<TanStackDevtools plugins={…} />`. */
export function composeDevtoolsPlugin(
  client: Client,
  options: ComposeDevtoolsPluginOptions = {},
): TanStackDevtoolsReactPlugin {
  return {
    id: 'tanstack-compose',
    name: options.name ?? 'TanStack Compose',
    render: (_element, properties) => (
      <ComposeDevtoolsPanel client={client} theme={properties.theme} />
    ),
  }
}

// Re-exporting the shell keeps a showcase mount to one package import while
// retaining @tanstack/react-devtools as the implementation and contract owner.
export { TanStackDevtools }
export type { TanStackDevtoolsReactPlugin }
