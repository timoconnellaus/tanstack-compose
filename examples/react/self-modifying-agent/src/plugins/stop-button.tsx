import { createPlugin } from '@tanstack/compose'
import { agentKey } from '@tanstack/compose-agent'
import { slotsKey, useStore } from '@tanstack/react-compose'
import { cancelAction } from '../actions'
import { chatInputActionsSlot } from '../slots'
import type { ReactNode } from 'react'

/**
 * The stop button: it depends on the **agent** and the **slot** registry, fills
 * the input box's actions slot, is enabled only while a **turn** is running, and
 * cancels the turn through an **action** when pressed (C2, C4).
 *
 * Nothing else on the page knows it exists. Disable this entry and the button
 * goes; add it back from the **plugin catalog** and it returns, in the same
 * place, with nothing else re-rendered.
 */
export const stopButtonPlugin = createPlugin({
  name: 'stop-button',
  deps: [agentKey, slotsKey],
  setup(instance) {
    const agent = instance.context.get(agentKey)
    const slots = instance.context.get(slotsKey)

    instance.defineAction(cancelAction, () => agent.cancel())

    const StopButton = (): ReactNode => {
      const status = useStore(agent.status)
      return (
        <button
          type="button"
          data-testid="stop-button"
          disabled={status !== 'running'}
          onClick={() => void instance.client.dispatch(cancelAction, undefined)}
        >
          Stop
        </button>
      )
    }

    instance.cleanup(
      slots.fill(chatInputActionsSlot, { order: 10, render: StopButton }),
      'fill(chat.input.actions)',
    )
  },
})
