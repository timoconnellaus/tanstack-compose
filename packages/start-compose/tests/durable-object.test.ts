import { inProcessHost } from '@tanstack/compose'
import {
  createServerStub,
  createSlotsStub,
  slotsPlugin,
  viewsPlugin,
} from '@tanstack/react-compose'
import { describe, expect, it, vi } from 'vitest'
import { createComposeDurableObject } from '../src'
import type { SerializedEntry } from '../src'
import type { SourceChecker } from '@tanstack/compose'

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
    const alarm = vi.fn()
    const schedule = vi.fn()
    const Tenant = createComposeDurableObject({
      base: FakeDurableObject,
      self: () => ({}) as DurableObjectStub,
      initialPluginList: baseEntries,
      catalog: { slots: slotsPlugin, views: viewsPlugin },
      grants: {
        slots: createSlotsStub({ slots: ['toolbar'] }),
        server: createServerStub(),
      },
      createHost: () => ({ ...inProcessHost, alarm, schedule }),
      baseVersion: 'v1',
    })
    const object = new Tenant(state.ctx, {})

    await object.snapshot()
    const operation = { method: 'cancel' }
    await object.composeSchedule(operation)
    expect(schedule).toHaveBeenCalledWith(operation)
    await object.alarm()
    expect(alarm).toHaveBeenCalledOnce()
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
    const log = state.values.get('compose:generations') as Array<{
      entries: Array<{ id: string }>
    }>
    expect(log.at(-1)?.entries).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ id: 'csv.view' })]),
    )
    await Promise.all(state.pending)
  })

  it('records a bad boot generation when the base changes and rechecks source', async () => {
    const state = fakeState()
    const checks: Array<{ selected: string; requested: string }> = []
    const createChecker = (selected: string): SourceChecker => ({
      check: (request) => {
        checks.push({ selected, requested: request.baseVersion })
        if (selected === 'v2' && request.source.includes('.rows')) {
          return {
            diagnostics: [
              {
                line: 2,
                column: 15,
                message: "Property 'rows' does not exist on type 'data'.",
              },
            ],
          }
        }
        return { code: request.source }
      },
    })
    const source = (method: 'rows' | 'records') => `let data
export default function ({ stubs }) { data = stubs.data }
export function read() { return data.${method}() }`
    const Tenant = createComposeDurableObject({
      base: FakeDurableObject,
      self: () => ({}) as DurableObjectStub,
      initialPluginList: () => [
        ...baseEntries,
        {
          id: 'sort-by-due',
          plugin: { source: source('rows') },
          stubs: [],
        },
      ],
      catalog: { slots: slotsPlugin, views: viewsPlugin },
      grants: {},
      createHost: () => ({
        ...inProcessHost,
        alarm: () => Promise.resolve(),
        schedule: () => Promise.resolve(),
      }),
      baseVersion: (id) => id ?? 'v1',
      createChecker,
    })
    const object = new Tenant(state.ctx, {})

    const v1 = await object.snapshot('v1')
    expect(v1).toMatchObject({
      generation: 0,
      baseVersion: 'v1',
      outcome: 'good',
      lastKnownGood: 0,
    })

    const v2 = await object.reset('v2')
    expect(v2).toMatchObject({
      generation: 1,
      baseVersion: 'v2',
      outcome: 'bad',
      lastKnownGood: 0,
    })
    expect(
      v2.instances.find((entry) => entry.id === 'sort-by-due'),
    ).toMatchObject({
      status: 'error',
      error: { message: expect.stringContaining('rows') },
    })

    const reverted = await object.revert(0)
    expect(reverted).toMatchObject({
      generation: 2,
      baseVersion: 'v2',
      outcome: 'bad',
      lastKnownGood: 0,
    })

    const fixed = await object.edit({
      type: 'write',
      entry: {
        id: 'sort-by-due',
        plugin: { source: source('records') },
        stubs: [],
      },
    })
    expect(fixed).toMatchObject({
      generation: 3,
      baseVersion: 'v2',
      outcome: 'good',
      lastKnownGood: 3,
    })
    expect(checks).toEqual(
      expect.arrayContaining([
        { selected: 'v1', requested: 'v1' },
        { selected: 'v2', requested: 'v2' },
      ]),
    )
  })
})
