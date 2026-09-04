import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  bankFixture,
  currencyFixture,
  exportCsvFixture,
  tenantStorageFixture,
} from '../src/fixtures'
import { currencyApp, tableApp, tenantsApp } from '../src/apps'
import { serializedEntriesForWritten } from '../src/written'
import type { ComposeDurableObject } from '@tanstack/start-compose'
import type { ShowcaseEnv } from '../src/tenant'

const tenant = (name = 'integration:table') =>
  (() => {
    const namespace = (env as unknown as ShowcaseEnv).TENANT
    return namespace.get(
      namespace.idFromName(name),
    ) as unknown as ComposeDurableObject
  })()

describe('the deployed table app', () => {
  it('adds, presses and removes the export facet through the tenant DO', async () => {
    const object = tenant()
    const initial = await object.snapshot('table')
    expect(initial.pluginList.map((entry) => entry.id)).toEqual([
      'slots',
      'views',
      'table',
    ])

    for (const entry of serializedEntriesForWritten(
      exportCsvFixture,
      tableApp,
    )) {
      await object.edit({ type: 'write', entry })
    }
    const added = await object.snapshot()
    const fill = added.fills.find((one) => one.instanceId === 'export-csv.view')
    expect(fill?.slot).toBe('table.actions')
    expect(fill?.view.type).toBe('stack')
    expect(
      fill?.view.type === 'stack' &&
        fill.view.children.some(
          (child) => child.type === 'button' && child.label === 'Export CSV',
        ),
    ).toBe(true)

    const csv = await object.press({
      viewInstanceId: 'export-csv.view',
      handler: 'exportCsv',
    })
    expect(csv).toContain('id,name,city,amount,due')
    expect(csv).toContain('Avery Stone')

    await object.edit({ type: 'remove', id: 'export-csv.view' })
    await object.edit({ type: 'remove', id: 'export-csv' })
    const removed = await object.snapshot()
    expect(removed.fills).not.toContainEqual(
      expect.objectContaining({ instanceId: 'export-csv.view' }),
    )
    // The workers test pool reports a rejecting RPC method as an unhandled
    // error, so removal is asserted through the snapshot: no instance, no fill.
    expect(removed.instances.map((instance) => instance.id)).toEqual([
      'slots',
      'views',
      'table',
    ])
  })

  it('uses the currency service binding and contains the bank refusal', async () => {
    const object = tenant('integration:currency')
    await object.snapshot('currency')
    for (const fixture of [currencyFixture, bankFixture]) {
      for (const entry of serializedEntriesForWritten(fixture, currencyApp)) {
        await object.edit({ type: 'write', entry })
      }
    }
    const snapshot = await object.snapshot()
    expect(snapshot.fills).toContainEqual(
      expect.objectContaining({
        slot: 'table.currency',
        view: expect.objectContaining({ type: 'stack' }),
      }),
    )
    expect(JSON.stringify(snapshot.fills)).toContain(
      'no service named \\"bank\\" is granted',
    )
  })

  it('keeps plugin lists and the same storage key isolated by Durable Object id', async () => {
    const left = tenant('integration:left:tenants')
    const right = tenant('integration:right:tenants')
    await left.snapshot('tenants')
    const rightBefore = await right.snapshot('tenants')
    const [entry] = serializedEntriesForWritten(
      { ...tenantStorageFixture, options: { value: 'left' } },
      tenantsApp,
    )
    await left.edit({ type: 'write', entry })

    expect(await right.snapshot()).toEqual(rightBefore)
    const [rightEntry] = serializedEntriesForWritten(
      { ...tenantStorageFixture, options: { value: 'right' } },
      tenantsApp,
    )
    await right.edit({ type: 'write', entry: rightEntry })
    expect(
      await left.callSource({ id: tenantStorageFixture.id, handler: 'read' }),
    ).toBe('left')
    expect(
      await right.callSource({ id: tenantStorageFixture.id, handler: 'read' }),
    ).toBe('right')
  })
})
