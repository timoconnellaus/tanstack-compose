import type { ScriptedResponse } from '@tanstack/compose-example-agent-runtime'

/** The facet the scripted model writes during the integration proof. */
export const writtenButtonSource = `const setup: Setup = async ({ stubs }) => {
  await stubs.slots.fill({
    slot: 'chat.input.actions',
    order: 20,
    view: {
      type: 'button',
      label: 'Facet hello',
      onPress: 'press',
      testId: 'facet-hello',
    },
  })
}
export default setup

export function press(): string {
  return 'hello from the isolated facet'
}
`

/** Two turns: write and acknowledge, then remove and acknowledge. */
export const scriptedConversation: Array<ScriptedResponse> = [
  {
    chunks: ['I will add a button from an isolated plugin.'],
    toolCalls: [
      {
        name: 'write_plugin',
        args: { id: 'facet-button', source: writtenButtonSource },
      },
    ],
  },
  { chunks: ['The facet button is ready.'] },
  {
    chunks: ['I will remove the isolated plugin now.'],
    toolCalls: [{ name: 'remove_plugin', args: { id: 'facet-button' } }],
  },
  { chunks: ['The facet plugin is removed.'] },
]
