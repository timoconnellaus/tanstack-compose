import { createPlugin } from '@tanstack/compose'
import { agentKey } from '@tanstack/compose-agent'
import { Slot, slotsKey, useStore } from '@tanstack/react-compose'
import { useRef, useState } from 'react'
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
  provides: [sendAction],
  setup(instance) {
    const slots = instance.context.get(slotsKey)
    const agent = instance.context.get(agentKey)

    instance.defineAction(sendAction, ({ text }) => {
      agent.send(text)
    })

    const InputBox = (): ReactNode => {
      const [draft, setDraft] = useState('')
      const textarea = useRef<HTMLTextAreaElement>(null)
      const status = useStore(agent.status)
      const send = (): void => {
        const text = draft.trim()
        if (!text || status === 'running') return
        setDraft('')
        if (textarea.current) textarea.current.style.height = 'auto'
        void instance.client.dispatch(sendAction, { text })
      }
      return (
        <form
          className="input-box"
          data-testid="input-box"
          onSubmit={(event) => {
            event.preventDefault()
            send()
          }}
        >
          <textarea
            ref={textarea}
            aria-label="Message"
            value={draft}
            rows={1}
            placeholder="Say something to the agent"
            onChange={(event) => {
              setDraft(event.target.value)
              event.currentTarget.style.height = 'auto'
              event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 112)}px`
            }}
            onKeyDown={(event) => {
              if (
                event.key !== 'Enter' ||
                event.shiftKey ||
                event.nativeEvent.isComposing
              ) {
                return
              }
              event.preventDefault()
              send()
            }}
          />
          <div className="input-actions">
            <button
              type="submit"
              disabled={draft.trim() === '' || status === 'running'}
            >
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
