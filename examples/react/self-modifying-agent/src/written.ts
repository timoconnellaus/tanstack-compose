/**
 * The **plugin source** the canned conversation has the agent write: a plugin
 * with a **tool** and a **view**, so the no-key demo shows the one thing the
 * page could not do before — the agent putting something on the page by writing
 * it.
 *
 * Both halves are ordinary written plugins, checked by `typescriptCheckerPlugin`
 * against the **plugin declarations** the composer derives from the **stubs**
 * the entry was granted. They are strings here for the same reason the model
 * sends strings: nothing imports them, and what type-checks is what runs.
 */

/**
 * The server half: one **tool** the model may call, whose handler is also what
 * the **view** reaches through its `server` stub. One function, two ways in.
 */
export const summariserSource = `const setup: Setup = async ({ stubs }) => {
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
}
export default setup

export function summarise(input: { text: string }): string {
  const words = input.text.split(/\\s+/).filter((word) => word !== '')
  return 'summary: ' + words.length + ' words'
}
`

/**
 * The **view**: a Summarise button beside Stop. Pressing it reads the end of the
 * **session** through the `session` stub, hands it to the plugin's own handler
 * through the `server` stub, and fills the same place again with the answer
 * beside the button — re-filling a slot replaces the fill that was there.
 */
export const summariserView = `let api: Stubs

const button: ViewNode = {
  type: 'button',
  label: 'Summarise',
  onPress: 'press',
}

const setup: Setup = async ({ stubs }) => {
  api = stubs
  await api.slots({ slot: 'chat.input.actions', order: 20, view: button })
}
export default setup

export async function press() {
  const entries = await api.session({ last: 8 })
  const text = entries.map((entry) => entry.text ?? '').join(' ')
  const summary = await api.server({ handler: 'summarise', input: { text } })
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

/** The same view, with the one mistake the **plugin declarations** catch (D2). */
export const summariserViewWithATypeError = summariserView.replace(
  "handler: 'summarise'",
  "handler: 'summarize'",
)
