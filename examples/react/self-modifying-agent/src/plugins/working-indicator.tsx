import { createPlugin } from '@tanstack/compose'
import { agentKey } from '@tanstack/compose-agent'
import { slotsKey, useStore } from '@tanstack/react-compose'
import { chatListTrailerSlot } from '../slots'
import type { ReactNode } from 'react'

/**
 * A quiet row at the end of the message list while a **turn** is running and
 * no text is arriving: between tool calls, or while the model is still
 * thinking. It fills the list's trailer slot, so the list knows nothing of it,
 * and it goes when this entry is disabled.
 */
export const workingIndicatorPlugin = createPlugin({
  name: 'working-indicator',
  deps: [agentKey, slotsKey],
  setup(instance) {
    const agent = instance.context.get(agentKey)
    const slots = instance.context.get(slotsKey)

    const WorkingRow = ({ streaming }: { streaming: boolean }): ReactNode => {
      const status = useStore(agent.status)
      if (status !== 'running' || streaming) return null
      return (
        <li className="working" data-testid="agent-working" aria-live="polite">
          <span className="working-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Agent is working
        </li>
      )
    }

    instance.cleanup(
      slots.fill(chatListTrailerSlot, { order: 0, render: WorkingRow }),
      'fill(chat.list.trailer)',
    )
  },
})
