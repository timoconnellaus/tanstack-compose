import { Link } from '@tanstack/react-router'
import { Slot } from '@tanstack/react-compose'
import { useMemo } from 'react'
import { notifications, pageSide } from '../base'
import { PluginPanel } from './plugin-panel'
import { useDeclareSlots } from './slots'
import type { ReactNode } from 'react'

/** The ordinary React shell around every showcase page. */
export function AppShell(properties: {
  children: ReactNode
  /** Tests render page components directly and do not need router links. */
  navigation?: boolean
}): ReactNode {
  const shellSlots = useMemo(() => [notifications, pageSide], [])
  useDeclareSlots(shellSlots)
  return (
    <div className="showcase-shell">
      <header className="site-header">
        <div>
          <p className="eyebrow">TanStack Compose</p>
          <h1>Runtime extension showcase</h1>
        </div>
        {properties.navigation === false ? null : (
          <nav aria-label="Showcase pages">
            <Link to="/table" activeProps={{ 'aria-current': 'page' }}>
              Table
            </Link>
            <Link to="/todo" activeProps={{ 'aria-current': 'page' }}>
              Todo
            </Link>
            <Link to="/hostile" activeProps={{ 'aria-current': 'page' }}>
              Hostile gallery
            </Link>
          </nav>
        )}
        <div className="notifications" aria-label="Notifications">
          <Slot of={notifications} />
        </div>
      </header>
      <div className="shell-grid">
        <div className="page-content">
          <main>{properties.children}</main>
          <Slot of={pageSide} />
        </div>
        <PluginPanel />
      </div>
    </div>
  )
}
