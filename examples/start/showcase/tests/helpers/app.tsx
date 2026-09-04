import { ComposeProvider } from '@tanstack/react-compose'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { AppShell } from '../../src/app/shell'
import { createShowcaseClient } from '../../src/compose-client'
import type { Client } from '@tanstack/compose'
import type { ReactNode } from 'react'

/** A fresh real showcase client with one page rendered in the ordinary shell. */
export interface StartedPage {
  client: Client
  stop: () => Promise<void>
}

/** Start and settle the real client, then render one page. */
export async function startPage(page: ReactNode): Promise<StartedPage> {
  const client = createShowcaseClient()
  await client.settled()
  await act(async () => {
    render(
      <ComposeProvider client={client}>
        <AppShell navigation={false}>{page}</AppShell>
      </ComposeProvider>,
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
