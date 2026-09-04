/// <reference types="vite/client" />
import {
  ClientOnly,
  HeadContent,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { SiteFrame } from '../app/shell'
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

function RootDocument({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ClientOnly fallback={<p className="booting">Starting…</p>}>
          <SiteFrame>{children}</SiteFrame>
        </ClientOnly>
        <Scripts />
      </body>
    </html>
  )
}
