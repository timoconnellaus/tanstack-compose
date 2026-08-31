import { describe, expect, it } from 'vitest'
import { createClient, createStub } from '@tanstack/compose'
import { testHost } from './helpers/host'

/** What a probe reports; whatever it managed to reach shows up here. */
type Report = Record<string, unknown>

/** Run one written plugin whose setup reports what it could reach. */
async function probe(body: string): Promise<Report> {
  let report: Report | undefined
  const reportStub = createStub<Report, void>({
    name: 'report',
    declarations: 'declare const report: (found: unknown) => Promise<void>',
    handler: ({ input }) => {
      report = input
    },
  })

  const client = createClient({
    hosts: { cloudflare: testHost({ callTimeoutMs: 2000 }) },
    plugins: [
      {
        id: 'prober',
        host: 'cloudflare',
        stubs: [reportStub],
        source: `
const tried = async (attempt) => {
  try {
    return { reached: await attempt() }
  } catch (error) {
    return { blocked: String(error && error.message ? error.message : error) }
  }
}

export default async function setup({ stubs }) {
  ${body}
}
`,
      },
    ],
  })
  await client.settled()
  const [snapshot] = client.inspect()
  expect(snapshot?.status).toBe('active')
  await client.destroy()
  return report!
}

describe('what a written plugin can reach', () => {
  it('cannot reach the network, directly or from a timer', async () => {
    const found = await probe(`
      const direct = await tried(() => fetch('https://example.com'))
      const sockets = await tried(async () => {
        const mod = await import('cloudflare:sockets')
        const socket = mod.connect('example.com:443')
        await socket.opened
        return 'connected'
      })
      const fromTimer = await tried(
        () =>
          new Promise((resolve, reject) => {
            setTimeout(() => {
              fetch('https://example.com').then(resolve, reject)
            }, 0)
          }),
      )
      await stubs.report({ direct, sockets, fromTimer })
    `)

    expect(found.direct).toMatchObject({
      blocked: expect.stringContaining('not permitted to access the internet'),
    })
    expect(found.sockets).toHaveProperty('blocked')
    expect(found.fromTimer).toHaveProperty('blocked')
  })

  it('cannot reach the loader, the process or a document through globals', async () => {
    const found = await probe(`
      const names = [
        'LOADER',
        'env',
        'ctx',
        'process',
        'require',
        'document',
        'window',
        'Deno',
        '__dirname',
        'ComposeHostedPlugin',
        'stubsFrom',
        'runs',
      ]
      const globals = {}
      for (const name of names) globals[name] = typeof globalThis[name]
      await stubs.report({ globals })
    `)

    expect(found.globals).toEqual({
      LOADER: 'undefined',
      env: 'undefined',
      ctx: 'undefined',
      process: 'undefined',
      require: 'undefined',
      document: 'undefined',
      window: 'undefined',
      Deno: 'undefined',
      __dirname: 'undefined',
      // The wrapper's own module scope is not the plugin's.
      ComposeHostedPlugin: 'undefined',
      stubsFrom: 'undefined',
      runs: 'undefined',
    })
  })

  it('cannot import anything the host did not load for it', async () => {
    const found = await probe(`
      const node = await tried(() => import('node:fs'))
      const bare = await tried(() => import('@tanstack/compose'))
      const sibling = await tried(() => import('./somewhere-else.js'))
      const wrapper = await tried(async () => {
        const mod = await import('./compose-host.js')
        return Object.keys(mod).join(',')
      })
      await stubs.report({ node, bare, sibling, wrapper })
    `)

    expect(found.node).toHaveProperty('blocked')
    expect(found.bare).toHaveProperty('blocked')
    expect(found.sibling).toHaveProperty('blocked')
    // The wrapper is a sibling module; importing it yields a class that is not
    // a way to anything, because every capability it has it took from `env`.
    expect(found.wrapper).toEqual({ reached: 'ComposeHostedPlugin' })
  })

  it('finds nothing in the isolate env but the stubs it was granted', async () => {
    const found = await probe(`
      const platform = await import('cloudflare:workers')
      const own = Object.keys(platform.env)
      const exported = Object.keys(platform.exports ?? {})
      const forge = await tried(async () =>
        platform.env.report.stubCall({ forged: true }),
      )
      await stubs.report({ own, exported, forge })
    `)

    // Reaching `env` the long way round hands it back what it already has.
    expect(found.own).toEqual(['report'])
    // The loader's exports are not among the isolate's own.
    expect(found.exported).not.toContain('ComposeStubLoopback')
    // Calling it that way is not a new authority: it is the same loopback the
    // `stubs` object wraps, bound to the same instance.
    expect(found.forge).toHaveProperty('reached')
  })
})
