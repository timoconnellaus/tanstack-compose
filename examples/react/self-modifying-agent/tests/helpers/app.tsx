import { createPlugin } from '@tanstack/compose'
import { modelKey, sessionKey } from '@tanstack/compose-agent'
import { ComposeProvider, Slot } from '@tanstack/react-compose'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { createAppClient } from '../../src/client'
import { rootSlot } from '../../src/slots'
import type { Client, PluginEntry } from '@tanstack/compose'
import type { ModelChunk, SessionLog } from '@tanstack/compose-agent'
import type { AppClientOptions } from '../../src/client'

/**
 * A **model provider** that takes its time, so a **turn** stays open long enough
 * for a person to press Stop.
 */
export const slowModelPlugin = createPlugin({
  name: 'slow-model',
  deps: [modelKey],
  setup(instance) {
    instance.cleanup(
      instance.context.get(modelKey).register({
        name: 'slow',
        stream: (_request, signal) =>
          (async function* stream(): AsyncGenerator<ModelChunk> {
            for (const text of ['thinking', ' about', ' it']) {
              await new Promise((resolve) => setTimeout(resolve, 25))
              if (signal.aborted) return
              yield { kind: 'text', text }
            }
          })(),
      }),
    )
  },
})

/** The slow provider as a **plugin entry**, ready for `createAppClient`. */
export const slowModel: PluginEntry = { id: 'model', plugin: slowModelPlugin }

/** The whole app, started and on the page. */
export interface StartedApp {
  client: Client
  session: SessionLog
  stop: () => Promise<void>
}

/** Start a client, render the root **slot** through the provider, settle. */
export async function startApp(
  options: AppClientOptions = {},
): Promise<StartedApp> {
  const client = createAppClient(options)
  await client.settled()
  await act(async () => {
    render(
      <ComposeProvider client={client}>
        <Slot of={rootSlot} />
      </ComposeProvider>,
    )
  })
  return {
    client,
    session: client.getContext(sessionKey)!,
    stop: async () => {
      await client.destroy()
    },
  }
}

/** Click something and let whatever it started settle. */
export async function press(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element)
  })
}

/** Press the panel's button for one entry. */
export async function pressInPanel(id: string, label: string): Promise<void> {
  const row = screen.getByTestId(`plugin-${id}`)
  await press(within(row).getByRole('button', { name: label }))
}

/** Type into the input box and press Send. */
export async function sendMessage(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: text },
    })
  })
  await press(screen.getByRole('button', { name: 'Send' }))
}
