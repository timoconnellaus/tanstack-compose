import { createPlugin } from '@tanstack/compose'
import { slotRegistryKey, viewRendererKey } from '@tanstack/compose-agent'
import { createViewRenderer, slotsKey } from '@tanstack/react-compose'
import type { SlotRegistry } from '@tanstack/compose-agent'
import type { AnySlot } from '@tanstack/react-compose'
import type { ComponentType } from 'react'

/**
 * The glue between the page and a written **view**: it publishes this page's
 * **slot** registry and its React renderer under the two **context keys** the
 * agent layer reads them through.
 *
 * It is twenty lines here rather than in either package on purpose.
 * `@tanstack/react-compose` knows nothing about agents (B1) and
 * `@tanstack/compose-agent` imports no framework, so neither of them can hold a
 * plugin that names both. This is the one place a React page and an agent meet,
 * and it is the operator's own entry — which is also why it is a **protected
 * entry**: a view that could remove it could take every view off the page.
 *
 * The two registry interfaces meet at `render`, which is `unknown` on the agent
 * side because nothing there may name a component type, and `ComponentType` on
 * this side. That is the one narrowing this plugin does, and it is sound: the
 * value came out of the renderer above, three lines away.
 */
export const viewsPlugin = createPlugin({
  name: 'views',
  deps: [slotsKey],
  provides: [slotRegistryKey, viewRendererKey],
  setup(instance) {
    const slots = instance.context.get(slotsKey)
    const registry: SlotRegistry = {
      slot: (name) => slots.slot(name),
      fill: (slot, fill) =>
        slots.fill(slot as AnySlot, {
          ...fill,
          render: fill.render as ComponentType<unknown>,
        }),
    }
    instance.provide(slotRegistryKey, registry)
    instance.provide(viewRendererKey, createViewRenderer())
  },
})
