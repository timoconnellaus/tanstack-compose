import { createPlugin } from '@tanstack/compose'
import { Slot, slotsKey } from '@tanstack/react-compose'
import { chatMainSlot, chatSideSlot, pageTitleSlot, rootSlot } from '../slots'
import type { ReactNode } from 'react'

function PageFrame(): ReactNode {
  return (
    <div className="page" data-testid="page-frame">
      <header className="page-header">
        <Slot of={pageTitleSlot} />
        <p>Every element below is a plugin.</p>
      </header>
      <div className="columns">
        <main className="column column-main">
          <Slot of={chatMainSlot} />
        </main>
        <aside className="column column-side">
          <Slot of={chatSideSlot} />
        </aside>
      </div>
    </div>
  )
}

/**
 * The page frame: the only plugin that fills `root`. It declares and renders the
 * two columns and decides their layout; what goes in them is nothing it knows
 * (A3). Disable it and the page is blank while everything else keeps running.
 */
export const pageFramePlugin = createPlugin({
  name: 'page-frame',
  deps: [slotsKey],
  setup(instance) {
    const slots = instance.context.get(slotsKey)
    instance.cleanup(slots.declare(pageTitleSlot), 'slot(page.title)')
    instance.cleanup(slots.declare(chatMainSlot), 'slot(chat.main)')
    instance.cleanup(slots.declare(chatSideSlot), 'slot(chat.side)')
    instance.cleanup(slots.fill(rootSlot, { render: PageFrame }), 'fill(root)')
  },
})
