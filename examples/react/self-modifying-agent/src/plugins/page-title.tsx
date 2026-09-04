import { createPlugin } from '@tanstack/compose'
import { slotsKey } from '@tanstack/react-compose'
import { pageTitleSlot } from '../slots'
import type { ReactNode } from 'react'

const PageTitle = (): ReactNode => (
  <h1 data-testid="page-title">Self-modifying agent</h1>
)

/**
 * The heading at the top of the page. The page frame leaves a slot where the
 * title goes; this plugin fills it. Disable it and the header keeps its line
 * about plugins and loses its title; another plugin filling `page.title` with
 * a higher order replaces it.
 */
export const pageTitlePlugin = createPlugin({
  name: 'page-title',
  deps: [slotsKey],
  setup(instance) {
    const slots = instance.context.get(slotsKey)
    instance.cleanup(
      slots.fill(pageTitleSlot, { order: 0, render: PageTitle }),
      'fill(page.title)',
    )
  },
})
