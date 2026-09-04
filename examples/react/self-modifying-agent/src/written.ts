/**
 * One source module the canned conversation writes. It contributes a tool and
 * a serialized fill; the callback is another export of the same plugin.
 */
export const summariserSource = `let api: Stubs

const button: ViewNode = {
  type: 'button',
  label: 'Summarise',
  onPress: 'press',
}

const setup: Setup = async ({ stubs }) => {
  api = stubs
  await stubs.tools({
    name: 'summarise',
    description: 'Summarise a piece of text',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    handler: 'summarise',
  })
  await api.slots({ slot: 'chat.input.actions', order: 20, view: button })
}
export default setup

export function summarise(input: { text: string }): string {
  const words = input.text.split(/\\s+/).filter((word) => word !== '')
  return 'summary: ' + words.length + ' words'
}

export async function press() {
  const entries = await api.session({ last: 8 })
  const text = entries.map((entry) => entry.text ?? '').join(' ')
  const summary = summarise({ text })
  await api.slots({
    slot: 'chat.input.actions',
    order: 20,
    view: {
      type: 'row',
      children: [button, { type: 'text', text: summary, tone: 'muted' }],
    },
  })
  return summary
}
`

/** Kept for older fixture imports; one module now owns both halves. */
export const summariserView = ''

/** A source mistake used by the checker test. */
export const summariserViewWithATypeError = summariserSource.replace(
  "handler: 'summarise'",
  "handlerName: 'summarise'",
)
