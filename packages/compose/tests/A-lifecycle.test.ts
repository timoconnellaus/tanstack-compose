import { describe, expect, it, vi } from 'vitest'
import {
  createAction,
  createClient,
  createContextKey,
  createEvent,
  definePlugin,
} from '../src/index'
import type { Instance } from '../src/index'

const valueKey = createContextKey<{ label: string }>('value')
const pingEvent = createEvent<string>('ping')
const runAction = createAction<string, string>('run')

describe('A. Lifecycle and cleanup', () => {
  it('A1 adding a plugin starts it and removing it leaves no trace', async () => {
    const heard: Array<string> = []
    const cleared = vi.fn()

    const child = definePlugin({
      name: 'child',
      setup(instance) {
        instance.cleanup(() => {
          heard.push('child cleanup')
        })
      },
    })

    const owner = definePlugin({
      name: 'owner',
      provides: [valueKey],
      setup(instance) {
        instance.provide(valueKey, { label: 'from owner' })
        instance.on(pingEvent, (message) => heard.push(message))
        instance.defineAction(runAction, (input) => `handled:${input}`)
        instance.use(runAction, ({ input, next }) => next(`wrapped:${input}`))
        instance.cleanup(cleared, 'timer')
        return instance.start(child).then(() => undefined)
      },
    })

    const client = createClient({ plugins: [{ id: 'owner', plugin: owner }] })
    await client.settled()

    expect(client.getContext(valueKey)).toEqual({ label: 'from owner' })
    expect(await client.dispatch(runAction, 'x')).toBe('handled:wrapped:x')
    client.emit(pingEvent, 'hello')
    expect(heard).toEqual(['hello'])
    expect(client.inspect().map((entry) => entry.id)).toEqual([
      'owner',
      'owner/child#0',
    ])

    await client.removePlugin('owner')

    expect(client.getContext(valueKey)).toBeUndefined()
    expect(cleared).toHaveBeenCalledTimes(1)
    expect(heard).toEqual(['hello', 'child cleanup'])
    client.emit(pingEvent, 'after')
    expect(heard).toEqual(['hello', 'child cleanup'])
    await expect(client.dispatch(runAction, 'x')).rejects.toThrow(
      /no plugin owns/,
    )
    expect(client.inspect()).toEqual([])
  })

  it('A2 removal reports complete only once every async cleanup has finished', async () => {
    const order: Array<string> = []
    let release: (() => void) | undefined
    const slow = definePlugin({
      name: 'slow',
      setup(instance) {
        instance.cleanup(
          () =>
            new Promise<void>((resolve) => {
              release = () => {
                order.push('cleaned')
                resolve()
              }
            }),
          'slow cleanup',
        )
      },
    })

    const client = createClient({ plugins: [{ id: 'slow', plugin: slow }] })
    await client.settled()

    const first = client.removePlugin('slow')
    const second = client.removePlugin('slow')
    let done = false
    void Promise.all([first, second]).then(() => {
      done = true
      order.push('reported')
    })

    await Promise.resolve()
    expect(done).toBe(false)
    release?.()
    await Promise.all([first, second])
    await client.settled()

    expect(order).toEqual(['cleaned', 'reported'])
    expect(client.inspect()).toEqual([])
    await expect(client.removePlugin('slow')).resolves.toBeUndefined()
  })

  it('A3 removing an instance removes every instance it started, recursively', async () => {
    const order: Array<string> = []
    const grandchild = definePlugin({
      name: 'grandchild',
      setup(instance) {
        instance.cleanup(() => {
          order.push('grandchild')
        })
      },
    })
    const child = definePlugin({
      name: 'child',
      async setup(instance) {
        await instance.start(grandchild)
        instance.cleanup(() => {
          order.push('child')
        })
      },
    })
    const parent = definePlugin({
      name: 'parent',
      async setup(instance) {
        await instance.start(child)
        instance.cleanup(() => {
          order.push('parent')
        })
      },
    })

    const client = createClient({ plugins: [{ id: 'parent', plugin: parent }] })
    await client.settled()
    expect(client.inspect()).toHaveLength(3)

    await client.removePlugin('parent')
    expect(order).toEqual(['parent', 'child', 'grandchild'])
    expect(client.inspect()).toEqual([])
  })

  it('A4 cleanups of one instance run in reverse order of registration', async () => {
    const order: Array<string> = []
    const plugin = definePlugin({
      name: 'ordered',
      setup(instance) {
        instance.cleanup(() => {
          order.push('first')
        })
        instance.cleanup(() => {
          order.push('second')
        })
        instance.cleanup(() => {
          order.push('third')
        })
      },
    })
    const client = createClient({ plugins: [{ id: 'ordered', plugin }] })
    await client.settled()
    await client.removePlugin('ordered')
    expect(order).toEqual(['third', 'second', 'first'])
  })

  it('A5 registering on an instance being removed or already removed throws', async () => {
    let handle: Instance | undefined
    const plugin = definePlugin({
      name: 'captured',
      setup(instance) {
        handle = instance
        instance.cleanup(() => {
          expect(() => handle?.cleanup(() => {})).toThrow(/being removed/)
        })
      },
    })
    const client = createClient({ plugins: [{ id: 'captured', plugin }] })
    await client.settled()
    await client.removePlugin('captured')

    expect(() => handle?.cleanup(() => {})).toThrow(/being removed/)
    expect(() => handle?.on(pingEvent, () => {})).toThrow(/being removed/)
    expect(() => handle?.provide(valueKey, { label: 'x' })).toThrow(
      /being removed/,
    )
  })

  it('A6 a plugin that throws during start ends in error with nothing left behind', async () => {
    const boom = new Error('boom')
    const cleaned = vi.fn()
    const broken = definePlugin({
      name: 'broken',
      provides: [valueKey],
      setup(instance) {
        instance.provide(valueKey, { label: 'half' })
        instance.cleanup(cleaned)
        throw boom
      },
    })
    const healthy = definePlugin({
      name: 'healthy',
      setup() {
        // nothing to do
      },
    })

    const client = createClient({
      plugins: [
        { id: 'broken', plugin: broken },
        { id: 'healthy', plugin: healthy },
      ],
    })
    await client.settled()

    const broke = client.inspect().find((entry) => entry.id === 'broken')
    expect(broke?.status).toBe('error')
    expect(broke?.error).toBe(boom)
    expect(cleaned).toHaveBeenCalledTimes(1)
    expect(client.getContext(valueKey)).toBeUndefined()
    expect(
      client.inspect().find((entry) => entry.id === 'healthy')?.status,
    ).toBe('active')
  })

  it('A7 a cleanup that throws is reported and the remaining cleanups still run', async () => {
    const order: Array<string> = []
    const plugin = definePlugin({
      name: 'noisy',
      setup(instance) {
        instance.cleanup(() => {
          order.push('first')
        })
        instance.cleanup(() => {
          throw new Error('cleanup failed')
        }, 'throws')
        instance.cleanup(() => {
          order.push('third')
        })
      },
    })
    const reported: Array<unknown> = []
    const client = createClient({
      plugins: [{ id: 'noisy', plugin }],
      onError: (report) => reported.push(report),
    })
    await client.settled()
    await client.removePlugin('noisy')

    expect(order).toEqual(['third', 'first'])
    expect(client.errors.state).toHaveLength(1)
    expect(client.errors.state[0]?.scope).toBe('cleanup')
    expect(reported).toHaveLength(1)
  })
})
