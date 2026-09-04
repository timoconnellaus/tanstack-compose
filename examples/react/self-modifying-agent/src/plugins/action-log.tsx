import { createPlugin } from '@tanstack/compose'
import { toolCallAction } from '@tanstack/compose-example-agent-runtime'
import { slotsKey, useStore } from '@tanstack/react-compose'
import { Store } from '@tanstack/store'
import { cancelAction, sendAction } from '../actions'
import { chatSideSlot } from '../slots'
import type { ReactNode } from 'react'

/**
 * One **middleware** plugin, to show that a click and a **tool** call are the
 * same kind of thing (C4). It wraps the send and cancel actions and every tool
 * call, and writes a line for each: pressing Send, pressing Stop, the model
 * calling a tool, and a person calling one from the panel — the **human step**
 * — all arrive here through the one mechanism.
 *
 * It registers `{ first: true }`, so it is the outermost wrapper and sees a call
 * before anything can refuse it.
 */
export const actionLogPlugin = createPlugin({
  name: 'action-log',
  deps: [slotsKey],
  setup(instance) {
    const lines = new Store<Array<string>>([])
    const write = (line: string): void => {
      console.log(`[action] ${line}`)
      lines.setState((previous) => [...previous.slice(-49), line])
    }

    instance.use(
      sendAction,
      ({ input, next }) => {
        write(`send "${input.text}"`)
        return next(input)
      },
      { first: true },
    )

    instance.use(
      cancelAction,
      ({ input, next }) => {
        write('cancel the turn')
        return next(input)
      },
      { first: true },
    )

    instance.use(
      toolCallAction,
      ({ input, next }) => {
        write(
          `${input.origin === 'human' ? 'a person' : `turn ${input.turn}`} calls ${input.call.name}`,
        )
        return next(input)
      },
      { first: true },
    )

    const ActionLog = (): ReactNode => {
      const written = useStore(lines)
      return (
        <section className="panel" data-testid="action-log">
          <h2>Actions</h2>
          <ol className="log">
            {written.map((line, at) => (
              // The log is append-only and never reordered.
              <li key={at}>{line}</li>
            ))}
          </ol>
        </section>
      )
    }

    instance.cleanup(
      instance.context
        .get(slotsKey)
        .fill(chatSideSlot, { order: 20, render: ActionLog }),
      'fill(chat.side)',
    )
  },
})
