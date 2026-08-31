import { createPlugin } from '@tanstack/compose'
import { agentKey, modelKey } from '@tanstack/compose-agent'
import { slotsKey, usePluginList } from '@tanstack/react-compose'
import { chatSideSlot } from '../slots'
import type { ReactNode } from 'react'

/**
 * The model picker: the registered **model providers**, and a click that selects
 * one through the composer's `select_model` **tool**, run as a **human step**
 * — the same call the model makes to swap providers, so the choice lands in the
 * **session** either way (C3). Selecting a provider restarts nothing; the next
 * **turn** takes it up.
 */
export const modelPickerPlugin = createPlugin({
  name: 'model-picker',
  deps: [slotsKey, modelKey, agentKey],
  setup(instance) {
    const slots = instance.context.get(slotsKey)
    const models = instance.context.get(modelKey)
    const agent = instance.context.get(agentKey)

    const ModelPicker = (): ReactNode => {
      // Providers come and go with plugin entries, so the plugin list is what
      // says the registry may read differently now.
      usePluginList()
      const providers = models.list()
      const current = models.current()
      return (
        <section className="panel" data-testid="model-picker">
          <h2>Model</h2>
          <ul>
            {providers.map((provider) => (
              <li key={provider.name}>
                <button
                  type="button"
                  disabled={provider === current}
                  onClick={() =>
                    void agent.invoke('select_model', { name: provider.name })
                  }
                >
                  {provider.name}
                </button>
                {provider === current ? <span> — in use</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )
    }

    instance.cleanup(
      slots.fill(chatSideSlot, { order: 10, render: ModelPicker }),
      'fill(chat.side)',
    )
  },
})
