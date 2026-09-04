import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

/**
 * The site around the apps: a header and the navigation between them. It holds
 * no client; each route below it is an individual app with its own.
 */
export function SiteFrame(properties: { children: ReactNode }): ReactNode {
  return (
    <div className="showcase-shell">
      <header className="site-header">
        <div>
          <p className="eyebrow">TanStack Compose</p>
          <h1>Runtime extension showcase</h1>
        </div>
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
          <Link to="/upgrade" activeProps={{ 'aria-current': 'page' }}>
            Upgrade
          </Link>
          <Link to="/pair" activeProps={{ 'aria-current': 'page' }}>
            Pair
          </Link>
        </nav>
        <div />
      </header>
      {properties.children}
    </div>
  )
}
