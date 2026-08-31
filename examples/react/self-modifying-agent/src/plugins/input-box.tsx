import { createPlugin } from '@tanstack/compose'
import { agentKey } from '@tanstack/compose-agent'
import { Slot, slotsKey } from '@tanstack/react-compose'
import { useState } from 'react'
import { sendAction } from '../actions'
import { chatInputActionsSlot, chatMainSlot } from '../slots'
import type { ReactNode } from 'react'

/**
 * The input box: it owns the send **action**, so a person's click reaches the
 * agent the same way anything else does and **middleware** can wrap it (C4). It
 * declares the actions slot beside it and decides that layout; the buttons in it
 * are other plugins' business.
 */
export const inputBoxPlugin = createPlugin({
  name: 'input-box',
  deps: [slotsKey, agentKey],
  setup(instance) {
    const slots = instance.context.get(slotsKey)
    const agent = instance.context.get(agentKey)

    instance.defineAction(sendAction, ({ text }) => {
      agent.send(text)
    })

    const InputBox = (): ReactNode => {
      const [draft, setDraft] = useState('')
      return (
        <form
          className="input-box"
          data-testid="input-box"
          onSubmit={(event) => {
            event.preventDefault()
            const text = draft.trim()
            if (!text) return
            setDraft('')
            void instance.client.dispatch(sendAction, { text })
          }}
        >
          <input
            aria-label="Message"
            value={draft}
            placeholder="Say something to the agent"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="input-actions">
            <button type="submit" disabled={draft.trim() === ''}>
              Send
            </button>
            <Slot of={chatInputActionsSlot} props={{ draft }} />
          </div>
        </form>
      )
    }

    instance.cleanup(
      slots.declare(chatInputActionsSlot),
      'slot(chat.input.actions)',
    )
    instance.cleanup(
      slots.fill(chatMainSlot, { order: 10, render: InputBox }),
      'fill(chat.main)',
    )
  },
})
