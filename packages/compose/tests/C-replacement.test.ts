import { describe, expect, it } from 'vitest'
import { createClient, createContextKey, definePlugin } from '../src/index'

const loggerKey = createContextKey<{
  log: (message: string) => void
  kind: string
}>('logger')

const makeLogger = (kind: string) =>
  definePlugin({
    name: `${kind}-logger`,
    provides: [loggerKey],
    setup(instance) {
      instance.provide(loggerKey, { kind, log: () => {} })
    },
  })

const consoleLogger = makeLogger('console')
const bufferLogger = makeLogger('buffer')

// Written once, with no knowledge that the provider can be swapped.
const seenKinds: Array<string> = []
const dependent = definePlugin({
  name: 'dependent',
  deps: [loggerKey],
  setup(instance) {
    seenKinds.push(instance.context.get(loggerKey).kind)
  },
})

describe('C. Replacement', () => {
  it('C1 every dependent runs against the new provider after a swap', async () => {
    seenKinds.length = 0
    const client = createClient({
      plugins: [
        { id: 'logger', plugin: consoleLogger },
        { id: 'dependent', plugin: dependent },
      ],
    })
    await client.settled()
    expect(seenKinds).toEqual(['console'])

    await client.setPluginList([
      { id: 'logger', plugin: bufferLogger },
      { id: 'dependent', plugin: dependent },
    ])

    expect(seenKinds).toEqual(['console', 'buffer'])
    expect(client.getContext(loggerKey)?.kind).toBe('buffer')
    expect(
      client.inspect().find((entry) => entry.id === 'dependent')?.status,
    ).toBe('active')
  })

  it('C2 there is no window in which a dependent is active against a removed provider', async () => {
    seenKinds.length = 0
    const client = createClient({
      plugins: [
        { id: 'logger', plugin: consoleLogger },
        { id: 'dependent', plugin: dependent },
      ],
    })
    await client.settled()

    const violations: Array<string> = []
    const check = () => {
      const dependentEntry = client.instances.state.find(
        (entry) => entry.id === 'dependent',
      )
      const provider = client.context.state.find(
        (entry) => entry.key === 'logger',
      )
      if (
        dependentEntry?.status === 'active' &&
        provider?.providedBy !== 'logger'
      ) {
        violations.push(
          `${dependentEntry.status}/${String(provider?.providedBy)}`,
        )
      }
    }
    const unsubscribeInstances = client.instances.subscribe(check)
    const unsubscribeContext = client.context.subscribe(check)

    await client.setPluginList([
      { id: 'logger', plugin: bufferLogger },
      { id: 'dependent', plugin: dependent },
    ])
    await client.removePlugin('logger')

    unsubscribeInstances.unsubscribe()
    unsubscribeContext.unsubscribe()

    expect(violations).toEqual([])
    expect(
      client.inspect().find((entry) => entry.id === 'dependent')?.status,
    ).toBe('pending')
  })
})
