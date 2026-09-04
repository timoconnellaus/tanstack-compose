import { createPlugin } from '@tanstack/compose'
import { inputKeysKey } from '../keys'

/**
 * Which key sends. The input box publishes a key registry and binds nothing
 * itself; each of these plugins binds one rule. Only one is enabled at a time,
 * and both sit in the **plugin catalog**, so swapping Enter for Ctrl+Enter is
 * disabling one entry and adding the other.
 */

/** Enter sends; Shift+Enter is a new line. */
export const sendOnEnterPlugin = createPlugin({
  name: 'send-on-enter',
  deps: [inputKeysKey],
  setup(instance) {
    instance.cleanup(
      instance.context.get(inputKeysKey).bind(({ event, send }) => {
        if (
          event.key !== 'Enter' ||
          event.shiftKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.nativeEvent.isComposing
        ) {
          return false
        }
        event.preventDefault()
        send()
        return true
      }),
      'bind(Enter)',
    )
  },
})

/** Ctrl+Enter (or Cmd+Enter) sends; Enter alone is a new line. */
export const sendOnCtrlEnterPlugin = createPlugin({
  name: 'send-on-ctrl-enter',
  deps: [inputKeysKey],
  setup(instance) {
    instance.cleanup(
      instance.context.get(inputKeysKey).bind(({ event, send }) => {
        if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) {
          return false
        }
        event.preventDefault()
        send()
        return true
      }),
      'bind(Ctrl+Enter)',
    )
  },
})
