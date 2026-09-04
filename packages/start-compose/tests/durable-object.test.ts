import { inProcessHost } from '@tanstack/compose'
import {
  createServerStub,
  createSlotsStub,
  slotsPlugin,
  viewsPlugin,
} from '@tanstack/react-compose'
import { describe, expect, it } from 'vitest'
import { createComposeDurableObject } from '../src'
import type { SerializedEntry } from '../src'

class FakeDurableObject {
  constructor(_ctx: DurableObjectState, _env: object) {}
}

const fakeState = () => {
  const values = new Map<string, unknown>()
  const pending: Array<Promise<unknown>> = []
  const ctx = {
    storage: {
      get: (key: string) => Promise.resolve(values.get(key)),
      put: (key: string, value: unknown) => {
        values.set(key, structuredClone(value))
        return Promise.resolve()
      },
    },
    getWebSockets: () => [],
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise)
    },
  } as unknown as DurableObjectState
  return { ctx, values, pending }
}

const baseEntries: Array<SerializedEntry> = [
  { id: 'slots', plugin: { catalog: 'slots' }, stubs: [] },
  { id: 'views', plugin: { catalog: 'views' }, stubs: [] },
]

const sourceEntry = (id: string, source: string, stubs: Array<string>) => ({
  id,
  plugin: { source },
  stubs,
})

describe('createComposeDurableObject', () => {
  it('persists edits, snapshots fills, presses their owner and unwraps source errors', async () => {
    const state = fakeState()
    const Tenant = createComposeDurableObject({
      base: FakeDurableObject,
      initialPluginList: baseEntries,
      catalog: { slots: slotsPlugin, views: viewsPlugin },
      grants: {
        slots: createSlotsStub({ slots: ['toolbar'] }),
        server: createServerStub(),
      },
      createHost: () => inProcessHost,
    })
    const object = new Tenant(state.ctx, {})

    await object.snapshot()
    await object.edit({
      type: 'write',
      entry: sourceEntry(
        'csv',
        `export default function () {}
export function exportCsv() { return 'id,name\\n1,Ada' }`,
        [],
      ),
    })
    const added = await object.edit({
      type: 'write',
      entry: sourceEntry(
        'csv.view',
        `let api
export default async function ({ stubs }) {
  api = stubs
  await stubs.slots({
    slot: 'toolbar',
    view: { type: 'button', label: 'Export CSV', onPress: 'download' },
  })
}
export function download() {
  return api.server({ handler: 'exportCsv' })
}`,
        ['slots', 'server'],
      ),
    })

    expect(added.pluginList.at(-1)?.plugin).toEqual({ written: true })
    expect(added.fills).toEqual([
      expect.objectContaining({
        instanceId: 'csv.view',
        slot: 'toolbar',
      }),
    ])
    await expect(
      object.press({ viewInstanceId: 'csv.view', handler: 'download' }),
    ).resolves.toBe('id,name\n1,Ada')

    await object.edit({
      type: 'write',
      entry: sourceEntry(
        'csv',
        `export default function () {}
export function exportCsv() { throw new Error('CSV is unavailable') }`,
        [],
      ),
    })
    await expect(
      object.press({ viewInstanceId: 'csv.view', handler: 'download' }),
    ).rejects.toMatchObject({
      message: 'CSV is unavailable',
      cause: expect.any(Error),
    })

    const statusGeneration = (await object.snapshot()).generation
    let attachment: unknown
    const socket = {
      close: () => undefined,
      deserializeAttachment: () => attachment,
      serializeAttachment: (value: unknown) => {
        attachment = value
      },
    } as unknown as WebSocket
    await object.webSocketMessage(
      socket,
      JSON.stringify({
        generation: statusGeneration,
        entries: [{ id: 'csv.view', status: 'active' }],
      }),
    )
    await expect(object.browserStatus()).resolves.toEqual([
      {
        generation: statusGeneration,
        entries: [{ id: 'csv.view', status: 'active' }],
      },
    ])
    object.webSocketClose(socket, 1000, 'done', true)
    await expect(object.browserStatus()).resolves.toEqual([])

    const removed = await object.edit({ type: 'remove', id: 'csv.view' })
    expect(removed.fills).toEqual([])
    expect(state.values.get('compose:plugin-list')).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ id: 'csv.view' })]),
    )
    await Promise.all(state.pending)
  })
})
