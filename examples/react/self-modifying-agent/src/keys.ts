import { createContextKey } from '@tanstack/compose'
import type { ContextKey } from '@tanstack/compose'
import type { KeyboardEvent } from 'react'

/** What a key binding sees: the key event, and the box's own send. */
export interface InputKeyContext {
  event: KeyboardEvent<HTMLTextAreaElement>
  send: () => void
}

/**
 * A binding returns `true` when it handled the key. The first binding to claim
 * a key wins; unclaimed keys reach the textarea as typing.
 */
export type InputKeyBinding = (context: InputKeyContext) => boolean

/** The input box's key bindings, a registry other plugins fill. */
export interface InputKeyRegistry {
  /** Add a binding. Returns its removal. */
  bind: (binding: InputKeyBinding) => () => void
  /** Offer a key event to the bindings, in the order they were added. */
  handle: (context: InputKeyContext) => boolean
}

/**
 * The **context key** the input box publishes its key bindings under. A plugin
 * that wants Enter, or Ctrl+Enter, or anything else to send depends on this
 * key and binds it; the input box itself binds nothing.
 */
export const inputKeysKey: ContextKey<InputKeyRegistry> =
  createContextKey<InputKeyRegistry>('ui.inputKeys')

export function createInputKeyRegistry(): InputKeyRegistry {
  const bindings = new Set<InputKeyBinding>()
  return {
    bind: (binding) => {
      bindings.add(binding)
      return () => {
        bindings.delete(binding)
      }
    },
    handle: (context) => {
      for (const binding of bindings) {
        if (binding(context)) return true
      }
      return false
    },
  }
}
