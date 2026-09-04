import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { exportCsvFixture } from '../src/fixtures'
import { tableApp } from '../src/apps'
import { serializedEntriesForWritten } from '../src/written'
import type { ComposeDurableObject } from '@tanstack/start-compose'
import type { ShowcaseEnv } from '../src/tenant'

const tenant = () =>
  (() => {
    const namespace = (env as unknown as ShowcaseEnv).TENANT
    return namespace.get(
      namespace.idFromName('integration:table'),
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
    expect(fill?.view.type).toBe('button')

    const csv = await object.press({
      viewInstanceId: 'export-csv.view',
      handler: 'downloadCsv',
    })
    expect(csv).toContain('id,name,city,amount,due')
    expect(csv).toContain('Avery Stone')

    await object.edit({ type: 'remove', id: 'export-csv.view' })
    await object.edit({ type: 'remove', id: 'export-csv' })
    const removed = await object.snapshot()
    expect(removed.fills).not.toContainEqual(
      expect.objectContaining({ instanceId: 'export-csv.view' }),
    )
    await expect(
      object.callSource({ id: 'export-csv', handler: 'exportCsv' }),
    ).rejects.toThrow('not active')
  })
})
