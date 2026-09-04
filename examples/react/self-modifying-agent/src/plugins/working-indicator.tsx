import { createPlugin } from '@tanstack/compose'
import {
  agentKey,
  optionsSchema,
} from '@tanstack/compose-example-agent-runtime'
import { slotsKey, useStore } from '@tanstack/react-compose'
import { chatListTrailerSlot } from '../slots'
import type { ReactNode } from 'react'

/**
 * A quiet row at the end of the message list while a **turn** is running and
 * no text is arriving: between tool calls, or while the model is still
 * thinking. It fills the list's trailer slot, so the list knows nothing of it,
 * and it goes when this entry is disabled. What it says is an **option**, so
 * `configure_plugin` changes the words and the row restarts with them.
 */
export const workingIndicatorPlugin = createPlugin({
  name: 'working-indicator',
  deps: [agentKey, slotsKey],
  validator: optionsSchema<{ text?: string } | undefined, { text: string }>(
    (value) => ({ text: value?.text ?? 'Agent is working' }),
    {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'What the row says while the agent is working.',
        },
      },
    },
  ),
  setup(instance, options) {
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
          {options.text}
        </li>
      )
    }

    instance.cleanup(
      slots.fill(chatListTrailerSlot, { order: 0, render: WorkingRow }),
      'fill(chat.list.trailer)',
    )
  },
})
