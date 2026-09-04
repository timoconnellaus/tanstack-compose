import { describe, expect, it } from 'vitest'
import {
  createClient,
  createPlugin,
  createStub,
  stubCallAction,
} from '@tanstack/compose'
import { defineGrant } from '@tanstack/compose/base'
import { testHost } from './helpers/host'
import type { GrantContext } from '@tanstack/compose/base'

/** A written plugin that says whatever it likes about who it is. */
const liar = `
export default async function setup({ stubs }) {
  await stubs.who({ instanceId: 'someone-else', stub: 'admin', hostId: 'other' })
}
`

describe('who a stub call arrives as', () => {
  it('carries the real instance id, whatever the plugin puts in the input', async () => {
    const seen: Array<{ instanceId: string; input: unknown }> = []
    const whoStub = createStub<unknown, void>({
      name: 'who',
      declarations: 'declare const who: (claim: unknown) => Promise<void>',
      handler: ({ instanceId, input }) => {
        seen.push({ instanceId, input })
      },
    })

    const client = createClient({
      hosts: { cloudflare: testHost({ callTimeoutMs: 2000 }) },
      plugins: [
        { id: 'honest-id', source: liar, host: 'cloudflare', stubs: [whoStub] },
      ],
    })
    await client.settled()

    expect(seen).toEqual([
      {
        instanceId: 'honest-id',
        input: {
          instanceId: 'someone-else',
          stub: 'admin',
          hostId: 'other',
        },
      },
    ])

    await client.destroy()
  })

  it('is an action middleware sees, with the real id, before the handler runs', async () => {
    const refused: Array<string> = []
    const whoStub = createStub<unknown, void>({
      name: 'who',
      declarations: 'declare const who: (claim: unknown) => Promise<void>',
      handler: () => {
        throw new Error('the handler should never have run')
      },
    })

    const client = createClient({
      hosts: { cloudflare: testHost({ callTimeoutMs: 2000 }) },
      plugins: [
        {
          id: 'watcher',
          plugin: createPlugin({
            name: 'watcher',
            setup(instance) {
              instance.use(stubCallAction, ({ input }) => {
                refused.push(`${input.instanceId}:${input.stub}`)
                throw new Error('refused by policy')
              })
            },
          }),
        },
        { id: 'honest-id', source: liar, host: 'cloudflare', stubs: [whoStub] },
      ],
    })
    await client.settled()

    // The refusal reached the plugin as an exception in its own setup.
    const hosted = client.inspect().find((one) => one.id === 'honest-id')
    expect(hosted?.status).toBe('error')
    expect(String((hosted?.error as Error).message)).toContain(
      'refused by policy',
    )
    expect(refused).toEqual(['honest-id:who'])

    await client.destroy()
  })

  it('only reaches stubs the entry was granted', async () => {
    const granted = createStub<void, string>({
      name: 'granted',
      declarations: 'declare const granted: () => Promise<string>',
      handler: () => 'yes',
    })

    let names: unknown
    const listStub = createStub<Array<string>, void>({
      name: 'list',
      declarations: 'declare const list: (names: unknown) => Promise<void>',
      handler: ({ input }) => {
        names = input
      },
    })

    const client = createClient({
      hosts: { cloudflare: testHost({ callTimeoutMs: 2000 }) },
      plugins: [
        {
          id: 'counter',
          host: 'cloudflare',
          stubs: [granted, listStub],
          source: `
export default async function setup({ stubs }) {
  await stubs.list(Object.keys(stubs).sort())
}
`,
        },
      ],
    })
    await client.settled()

    expect(names).toEqual(['granted', 'list'])

    await client.destroy()
  })

  it('exposes a method-shaped grant as a Proxy-free method object', async () => {
    let received: unknown
    const data = defineGrant({
      name: 'data',
      methods: {
        rows(filter: { prefix: string }, context: GrantContext) {
          received = { filter, instanceId: context.instanceId }
          return ['one']
        },
      },
    })
    const report = createStub<unknown, void>({
      name: 'report',
      declarations: 'declare const report: (value: unknown) => Promise<void>',
      handler: ({ input }) => {
        received = { received, reported: input }
      },
    })
    const client = createClient({
      hosts: { cloudflare: testHost({ callTimeoutMs: 2000 }) },
      plugins: [
        {
          id: 'methods',
          host: 'cloudflare',
          stubs: [data, report],
          source: `
export default async function setup({ stubs }) {
  const rows = await stubs.data.rows({ prefix: 'a' })
  await stubs.report({ names: Object.keys(stubs.data), rows })
}
`,
        },
      ],
    })
    await client.settled()

    expect(received).toEqual({
      received: { filter: { prefix: 'a' }, instanceId: 'methods' },
      reported: { names: ['rows'], rows: ['one'] },
    })

    await client.destroy()
  })
})
