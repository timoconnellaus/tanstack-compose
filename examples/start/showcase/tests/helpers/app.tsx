import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { AppFrame } from '../../src/app/app-frame'
import { createAppClient } from '../../src/browser-clients'
import type { ShowcaseApp } from '../../src/apps'
import type { Client } from '@tanstack/compose'
import type { ReactNode } from 'react'

/** A fresh real client for one app with its page rendered in the app frame. */
export interface StartedApp {
  client: Client
  stop: () => Promise<void>
}

/** Start and settle one app's real client, then render one of its pages. */
export async function startApp(
  app: ShowcaseApp,
  page: ReactNode,
): Promise<StartedApp> {
  const client = createAppClient(app)
  await client.settled()
  await act(async () => {
    render(
      <AppFrame app={app} client={client}>
        {page}
      </AppFrame>,
    )
    await Promise.resolve()
  })
  return {
    client,
    stop: async () => {
      cleanup()
      await client.destroy()
    },
  }
}

/** Click an element and flush work directly started by the event. */
export async function press(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element)
    await Promise.resolve()
  })
}

/** Press a button in one row of the plugin panel. */
export async function pressInPanel(id: string, label: string): Promise<void> {
  const row = document.querySelector(`[data-testid="plugin-${id}"]`)
  if (!(row instanceof HTMLElement)) throw new Error(`missing panel row ${id}`)
  await press(within(row).getByRole('button', { name: label }))
}
