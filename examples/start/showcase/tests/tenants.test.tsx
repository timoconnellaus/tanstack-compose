import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { AppFrame } from '../src/app/app-frame'
import { TenantPanel } from '../src/app/tenants-page'
import { tenantsApp } from '../src/apps'
import { createAppClient } from '../src/browser-clients'
import { tenantStorageFixture } from '../src/fixtures'
import { press } from './helpers/app'
import type { Client } from '@tanstack/compose'

let clients: Array<Client> = []

afterEach(async () => {
  cleanup()
  await Promise.all(clients.map((client) => client.destroy()))
  clients = []
})

describe('the two tenants page', () => {
  test('the same source and storage key stay isolated', async () => {
    const left = createAppClient(tenantsApp)
    const right = createAppClient(tenantsApp)
    clients = [left, right]
    await Promise.all(clients.map((client) => client.settled()))
    await act(() => {
      render(
        <div>
          <AppFrame app={tenantsApp} client={left}>
            <TenantPanel label="A" value="alpha" />
          </AppFrame>
          <AppFrame app={tenantsApp} client={right}>
            <TenantPanel label="B" value="bravo" />
          </AppFrame>
        </div>,
      )
    })

    await press(screen.getByRole('button', { name: 'Add to tenant A' }))
    await left.settled()
    expect(
      left.pluginList.state.some(
        (entry) => entry.id === tenantStorageFixture.id,
      ),
    ).toBe(true)
    expect(
      right.pluginList.state.some(
        (entry) => entry.id === tenantStorageFixture.id,
      ),
    ).toBe(false)
    await expect(
      left.callSource(tenantStorageFixture.id, 'read'),
    ).resolves.toBe('alpha')

    await press(screen.getByRole('button', { name: 'Add to tenant B' }))
    await right.settled()
    await expect(
      right.callSource(tenantStorageFixture.id, 'read'),
    ).resolves.toBe('bravo')
    await expect(
      left.callSource(tenantStorageFixture.id, 'read'),
    ).resolves.toBe('alpha')
  })
})
