import { createAction, createContextKey } from '@tanstack/compose'
import type { ToolOutcome } from '@tanstack/compose-agent'

/**
 * Everything a person can do to the agent from this page is an **action**, so
 * **middleware** wraps a click exactly as it wraps the model's **tool** call
 * (C4). The plugin that owns the button owns the action's handler, so disabling
 * that plugin takes the action with it.
 */

/** Sending what is typed in the input box. Owned by the input box plugin. */
export const sendAction = createAction<{ text: string }, void>('ui.send')

/** Stopping the open **turn**. Owned by the stop button plugin. */
export const cancelAction = createAction<void, void>('ui.cancel')

/** How the UI runs one of the agent's own tools. */
export interface UiTools {
  /**
   * Run a registered tool by name and record it in the **session**, through the
   * same `toolCallAction` the loop dispatches, so a person's edit and the
   * model's edit take one path (C3).
   */
  call: (name: string, args: unknown) => Promise<ToolOutcome>
}

/** The **context key** the UI reaches the agent's tools through. */
export const uiToolsKey = createContextKey<UiTools>('ui.tools')
