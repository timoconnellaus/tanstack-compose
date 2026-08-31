import { describe, expect, it } from 'vitest'
import { createClient, createContextKey, definePlugin } from '../src/index'
import type { PluginEntry } from '../src/index'

const seatKey = createContextKey<string>('seat')

const makePlugin = (name: string, log: Array<string>) =>
  definePlugin({
    name,
    setup(instance) {
      log.push(`start:${name}:${instance.id}`)
      instance.cleanup(() => {
        log.push(`stop:${name}:${instance.id}`)
      })
    },
  })

describe('F. Plugin list', () => {
  it('F1 the plugin list is a store and reconciling only touches entries that changed', async () => {
    const log: Array<string> = []
    const alpha = makePlugin('alpha', log)
    const beta = makePlugin('beta', log)
    const gamma = makePlugin('gamma', log)

    const client = createClient({
      plugins: [
        { id: 'a', plugin: alpha },
        { id: 'b', plugin: beta },
      ],
    })
    await client.settled()
    expect(log).toEqual(['start:alpha:a', 'start:beta:b'])
    expect(client.pluginList.state.map((entry) => entry.id)).toEqual(['a', 'b'])

    log.length = 0
    // Written straight to the store, as an adapter or devtools would (ADR-0002).
    client.pluginList.setState((list) => [
      ...list.filter((entry) => entry.id !== 'b'),
      { id: 'c', plugin: gamma } satisfies PluginEntry,
    ])
    await client.settled()

    expect(log).toEqual(['stop:beta:b', 'start:gamma:c'])
    expect(client.inspect().map((entry) => entry.id)).toEqual(['a', 'c'])
  })

  it('F2 enabled false is equivalent to removal and enabling restores the instance', async () => {
    const log: Array<string> = []
    const provider = definePlugin({
      name: 'provider',
      provides: [seatKey],
      setup(instance) {
        instance.provide(seatKey, 'taken')
      },
    })
    const dependent = definePlugin({
      name: 'dependent',
      deps: [seatKey],
      setup(instance) {
        log.push(`start:${instance.context.get(seatKey)}`)
        instance.cleanup(() => {
          log.push('stop')
        })
      },
    })

    const client = createClient({
      plugins: [
        { id: 'provider', plugin: provider },
        { id: 'dependent', plugin: dependent },
      ],
    })
    await client.settled()
    expect(log).toEqual(['start:taken'])

    await client.setEnabled('provider', false)
    expect(client.inspect().map((entry) => [entry.id, entry.status])).toEqual([
      ['dependent', 'pending'],
    ])
    expect(client.inspect()[0]?.missing).toEqual(['seat'])
    expect(log).toEqual(['start:taken', 'stop'])
    expect(client.getContext(seatKey)).toBeUndefined()

    await client.setEnabled('provider', true)
    expect(client.inspect().map((entry) => entry.status)).toEqual([
      'active',
      'active',
    ])
    expect(log).toEqual(['start:taken', 'stop', 'start:taken'])
  })

  it('F3 a reconcile that fails leaves the client in the previous consistent state', async () => {
    const log: Array<string> = []
    const alpha = makePlugin('alpha', log)
    const client = createClient({ plugins: [{ id: 'a', plugin: alpha }] })
    await client.settled()
    const applied = client.pluginList.state
    log.length = 0

    await expect(
      client.setPluginList([
        { id: 'a', plugin: alpha },
        { id: 'a', plugin: alpha },
      ]),
    ).rejects.toThrow(/duplicate plugin entry id "a"/)
    await client.settled()

    expect(log).toEqual([])
    expect(client.pluginList.state).toBe(applied)
    expect(client.inspect().map((entry) => [entry.id, entry.status])).toEqual([
      ['a', 'active'],
    ])
    expect(client.errors.state.map((report) => report.scope)).toEqual([
      'reconcile',
    ])

    // The client still works afterwards.
    await client.addPlugin({ id: 'b', plugin: makePlugin('beta', log) })
    expect(client.inspect().map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('F4 overlapping list edits are serialised and apply in order', async () => {
    const log: Array<string> = []
    const slow = definePlugin({
      name: 'slow',
      async setup(instance) {
        await new Promise((resolve) => setTimeout(resolve, 5))
        log.push('start:slow')
        instance.cleanup(() => {
          log.push('stop:slow')
        })
      },
    })
    const quick = makePlugin('quick', log)

    const client = createClient()
    const first = client.addPlugin({ id: 'slow', plugin: slow })
    // Let the first reconcile begin, then edit the list while it is still running.
    await Promise.resolve()
    const second = client.addPlugin({ id: 'quick', plugin: quick })
    const third = client.removePlugin('slow')
    await Promise.all([first, second, third])
    await client.settled()

    // The second pass waited for the first: 'slow' finished starting before it
    // was stopped, and nothing interleaved.
    expect(log).toEqual(['start:slow', 'stop:slow', 'start:quick:quick'])
    expect(client.inspect().map((entry) => entry.id)).toEqual(['quick'])
  })

  it('F5 a plugin can edit the plugin list it belongs to, including disabling itself', async () => {
    const log: Array<string> = []
    const helper = makePlugin('helper', log)
    const selfEditing = definePlugin({
      name: 'self-editing',
      setup(instance) {
        log.push('start:self-editing')
        instance.cleanup(() => {
          log.push('stop:self-editing')
        })
        // Both edits are awaited from inside setup: neither may deadlock.
        return instance.client
          .addPlugin({ id: 'helper', plugin: helper })
          .then(() => instance.client.setEnabled('self-editing', false))
      },
    })

    const client = createClient({
      plugins: [{ id: 'self-editing', plugin: selfEditing }],
    })
    await client.settled()

    expect(log).toEqual([
      'start:self-editing',
      'stop:self-editing',
      'start:helper:helper',
    ])
    expect(client.inspect().map((entry) => entry.id)).toEqual(['helper'])
    expect(
      client.pluginList.state.map((entry) => [entry.id, entry.enabled ?? true]),
    ).toEqual([
      ['self-editing', false],
      ['helper', true],
    ])
  })
})
