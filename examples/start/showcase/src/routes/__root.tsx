/// <reference types="vite/client" />
import {
  ClientOnly,
  HeadContent,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { ComposeProvider } from '@tanstack/react-compose'
import { Suspense } from 'react'
import { AppShell } from '../app/shell'
import { getBrowserClient } from '../client'
import styles from '../styles.css?url'
import type { ReactNode } from 'react'

export const Route = createRootRoute({
  ssr: false,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'TanStack Compose showcase' },
    ],
    links: [{ rel: 'stylesheet', href: styles }],
  }),
  shellComponent: RootDocument,
})

function BrowserShell({ children }: { children: ReactNode }): ReactNode {
  const client = getBrowserClient()
  return (
    <ComposeProvider client={client}>
      <AppShell>
        <Suspense fallback={<p>Starting client…</p>}>{children}</Suspense>
      </AppShell>
    </ComposeProvider>
  )
}

function RootDocument({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ClientOnly fallback={<p className="booting">Starting client…</p>}>
          <BrowserShell>{children}</BrowserShell>
        </ClientOnly>
        <Scripts />
      </body>
    </html>
  )
}
