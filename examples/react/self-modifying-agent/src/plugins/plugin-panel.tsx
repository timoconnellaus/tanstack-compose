import { createPlugin } from '@tanstack/compose'
import { agentKey } from '@tanstack/compose-example-agent-runtime'
import {
  slotsKey,
  useContextKey,
  useInstances,
  usePluginList,
} from '@tanstack/react-compose'
import { protectedIds } from '../client'
import { chatSideSlot } from '../slots'
import type { ReactNode } from 'react'

/**
 * The plugin panel: the **plugin list** with each entry's **status**, live.
 *
 * Every edit it makes goes through the composer's own **tools** —
 * `enable_plugin`, `disable_plugin`, `remove_plugin` — run as a **human step**
 * through `agent.invoke`, so a person's edit and the model's edit take one path
 * and both land in the **session** (C3). The panel never writes to the plugin
 * list itself, which is also why a **protected entry** refuses a person exactly
 * as it refuses the model.
 *
 * It reads the **agent** with the adapter's context hook rather than through
 * its own `deps`, so that disabling the loop leaves the panel on the page with
 * its buttons inert, instead of taking the panel with it (B2).
 */
function PluginPanel(): ReactNode {
  const entries = usePluginList()
  const instances = useInstances()
  const agent = useContextKey(agentKey)
  const statusOf = (id: string): string => {
    const entry = entries.find((one) => one.id === id)
    if (entry?.enabled === false) return 'disabled'
    return instances.find((one) => one.id === id)?.status ?? 'removed'
  }

  return (
    <section className="panel" data-testid="plugin-panel">
      <h2>Plugins</h2>
      <ul>
        {entries.map((entry) => {
          const status = statusOf(entry.id)
          const enabled = entry.enabled !== false
          if (protectedIds.has(entry.id)) {
            return (
              <li key={entry.id} data-testid={`plugin-${entry.id}`}>
                <span className="plugin-name">{entry.id}</span>
                <span className={`status status-${status}`}>{status}</span>
                <span
                  className="protected"
                  title="The agent's own parts cannot be disabled or removed from the panel"
                >
                  protected
                </span>
              </li>
            )
          }
          return (
            <li key={entry.id} data-testid={`plugin-${entry.id}`}>
              <span className="plugin-name">{entry.id}</span>
              <span className={`status status-${status}`}>{status}</span>
              <button
                type="button"
                disabled={!agent}
                onClick={() =>
                  void agent?.invoke(
                    enabled ? 'disable_plugin' : 'enable_plugin',
                    { id: entry.id },
                  )
                }
              >
                {enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                type="button"
                disabled={!agent}
                onClick={() =>
                  void agent?.invoke('remove_plugin', { id: entry.id })
                }
              >
                Remove
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Fills the side column with the plugin list. */
export const pluginPanelPlugin = createPlugin({
  name: 'plugin-panel',
  deps: [slotsKey],
  setup(instance) {
    instance.cleanup(
      instance.context
        .get(slotsKey)
        .fill(chatSideSlot, { order: 0, render: PluginPanel }),
      'fill(chat.side)',
    )
  },
})
