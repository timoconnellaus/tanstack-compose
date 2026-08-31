import { createAction } from '@tanstack/compose'

/**
 * Everything a person can do to the agent from this page is an **action**, so
 * **middleware** wraps a click exactly as it wraps the model's **tool** call
 * (C4). The plugin that owns the button owns the action's handler, so disabling
 * that plugin takes the action with it.
 *
 * Running one of the agent's own tools is an action too, and not one this app
 * defines: it is `agent.invoke`, the **human step**, which dispatches the same
 * `toolCallAction` the loop dispatches for the model.
 */

/** Sending what is typed in the input box. Owned by the input box plugin. */
export const sendAction = createAction<{ text: string }, void>('ui.send')

/** Stopping the open **turn**. Owned by the stop button plugin. */
export const cancelAction = createAction<void, void>('ui.cancel')
