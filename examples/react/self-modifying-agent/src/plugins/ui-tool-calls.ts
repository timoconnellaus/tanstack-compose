import { createPlugin } from '@tanstack/compose'
import {
  sessionKey,
  toolCallAction,
  toolsKey,
  validateArgs,
} from '@tanstack/compose-agent'
import { uiToolsKey } from '../actions'
import type { ToolOutcome } from '@tanstack/compose-agent'

/** UI-issued calls carry turn 0: no **turn** is open when a person clicks. */
const UI_TURN = 0

let issued = 0

/**
 * The one path a person's edit takes to the agent's own tools.
 *
 * The loop owns `toolCallAction`, but its handler only knows the **tools** the
 * open **turn** was built with — between turns there is no open turn at all. So
 * this plugin wraps the action with **middleware** that runs a UI-issued call
 * against the live **tool** registry, and records the call and its result in the
 * **session**. Everything else about the call is unchanged: it is the same
 * action, so every other plugin's middleware sees a click and a model tool call
 * alike (C3, C4).
 *
 * Middleware registered `{ first: true }` — the action log below is one — wraps
 * this, so a UI-issued call is observable and interceptable.
 */
export const uiToolCallsPlugin = createPlugin({
  name: 'ui-tool-calls',
  deps: [toolsKey, sessionKey],
  provides: [uiToolsKey],
  setup(instance) {
    const tools = instance.context.get(toolsKey)
    const session = instance.context.get(sessionKey)

    instance.use(
      toolCallAction,
      async ({ input, next }): Promise<ToolOutcome> => {
        if (input.turn !== UI_TURN) return next(input)
        const tool = tools.get(input.call.name)
        if (!tool) {
          return { ok: false, error: `unknown tool "${input.call.name}"` }
        }
        const validated = await validateArgs(tool, input.call.args)
        if (!validated.ok) return validated
        try {
          const value: unknown = await tool.execute(validated.value, {
            call: input.call,
            signal: new AbortController().signal,
          })
          return { ok: true, value }
        } catch (error) {
          return { ok: false, error: String(error) }
        }
      },
    )

    instance.provide(uiToolsKey, {
      call: async (name: string, args: unknown): Promise<ToolOutcome> => {
        issued += 1
        const call = { id: `ui-${issued}`, name, args }
        session.append({ kind: 'tool-call', turn: UI_TURN, step: 0, call })
        const outcome = await instance.client.dispatch(toolCallAction, {
          call,
          turn: UI_TURN,
          step: 0,
        })
        session.append({
          kind: 'tool-result',
          turn: UI_TURN,
          step: 0,
          callId: call.id,
          name,
          outcome,
        })
        return outcome
      },
    })
  },
})
