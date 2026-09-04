import {
  createAction,
  createClient,
  createContextKey,
  createPlugin,
} from '@tanstack/compose'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createDevtools } from '../src/index'
import type { Client } from '@tanstack/compose'

let client: Client | undefined

afterEach(async () => {
  await client?.destroy()
  client = undefined
})

describe('framework-neutral devtools', () => {
  test('snapshots plugin entries, unmet key and action deps, and errors', async () => {
    const settings = createContextKey<string>('settings')
    const runTask = createAction<void, void>('tasks.run')
    const logger = createPlugin({
      name: 'logger',
      setup(instance) {
        instance.cleanup(() => undefined, 'flush logs')
      },
    })
    const pending = createPlugin({
      name: 'worker',
      deps: [settings, runTask],
      setup() {},
    })
    const broken = createPlugin({
      name: 'broken',
      setup() {
        throw new Error('setup failed', { cause: new Error('socket closed') })
      },
    })

    client = createClient({ errorLimit: 4 })
    await client.addPlugin({ id: 'logger', plugin: logger })
    await client.addPlugin({ id: 'worker', plugin: pending })
    await client.addPlugin({ id: 'broken', plugin: broken })

    const snapshot = createDevtools({ client }).snapshot()

    expect(snapshot.pluginList).toEqual([
      { id: 'logger', enabled: true, granted: [], plugin: 'logger' },
      { id: 'worker', enabled: true, granted: [], plugin: 'worker' },
      { id: 'broken', enabled: true, granted: [], plugin: 'broken' },
    ])
    expect(snapshot.instances).toContainEqual({
      id: 'worker',
      plugin: 'worker',
      status: 'pending',
      phase: 'idle',
      unmetDeps: ['settings', 'tasks.run'],
    })
    expect(snapshot.resources).toContainEqual({
      instanceId: 'logger',
      tree: {
        label: 'logger (logger)',
        children: [{ label: 'flush logs', children: [] }],
      },
    })
    expect(snapshot.errors).toContainEqual({
      message: 'setup failed',
      instanceId: 'broken',
      phase: 'setup',
      cause: { message: 'socket closed', name: 'Error' },
    })
    expect(() => JSON.stringify(snapshot)).not.toThrow()
  })

  test('close removes subscriptions so later store changes do not notify', async () => {
    client = createClient()
    const devtools = createDevtools({ client })
    const subscriber = vi.fn()
    devtools.subscribe(subscriber)

    await client.addPlugin({
      id: 'first',
      plugin: createPlugin({ name: 'first', setup() {} }),
    })
    expect(subscriber).toHaveBeenCalled()

    subscriber.mockClear()
    devtools.close()
    await client.addPlugin({
      id: 'second',
      plugin: createPlugin({ name: 'second', setup() {} }),
    })
    expect(subscriber).not.toHaveBeenCalled()
  })
})
