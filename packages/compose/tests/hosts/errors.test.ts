import { describe, expect, it } from 'vitest'
import {
  createClient,
  createContextKey,
  createPlugin,
  createStub,
  sourceCheckerKey,
  sourceErrorOf,
} from '../../src/index'
import type { Client, SourceChecker } from '../../src/index'

const callsKey =
  createContextKey<Map<string, (input: unknown) => unknown>>('calls')

const registry = createPlugin({
  name: 'registry',
  provides: [callsKey],
  setup(instance) {
    instance.provide(callsKey, new Map())
  },
})

/** Lets a written plugin publish one of its named exports as a callable. */
const exposeStub = createStub<{ name: string; handler: string }, void>({
  name: 'expose',
  declarations:
    'declare const expose: (handler: { name: string; handler: string }) => Promise<void>',
  deps: [callsKey],
  handler: ({ input, instance, call }) => {
    const calls = instance.context.get(callsKey)
    calls.set(input.name, (argument) => call(input.handler, argument))
    instance.cleanup(() => {
      calls.delete(input.name)
    }, input.name)
  },
})

const write = async (source: string, checker?: SourceChecker) => {
  const client = createClient({
    plugins: [
      { id: 'registry', plugin: registry },
      ...(checker
        ? [
            {
              id: 'checker',
              plugin: createPlugin({
                name: 'checker',
                provides: [sourceCheckerKey],
                setup(instance) {
                  instance.provide(sourceCheckerKey, checker)
                },
              }),
            },
          ]
        : []),
      { id: 'a', source, stubs: [exposeStub] },
    ],
  })
  await client.settled()
  return client
}

const failure = (client: Client) => {
  const snapshot = client.inspect().find((one) => one.id === 'a')
  return { snapshot, detail: sourceErrorOf(snapshot?.error) }
}

/**
 * A ten-line reference checker: it rejects a marker string and strips the
 * annotations a real one would have compiled away. It exists to prove the seam,
 * not to check anything.
 */
const markerChecker: SourceChecker = {
  check({ source }) {
    const at = source.split('\n').findIndex((line) => line.includes('NOPE'))
    if (at !== -1) {
      return {
        diagnostics: [
          { message: "'NOPE' is not assignable", line: at + 1, column: 3 },
        ],
      }
    }
    return { code: source.replaceAll(': number', '') }
  },
}

describe('a failure in plugin source', () => {
  it('leaves the entry in error when the source does not parse', async () => {
    const client = await write('export default function ( {')
    const { snapshot, detail } = failure(client)

    expect(snapshot?.status).toBe('error')
    expect(detail?.phase).toBe('parse')
    expect(detail?.message).toBeTruthy()
    expect(client.inspect().find((one) => one.id === 'registry')?.status).toBe(
      'active',
    )
  })

  it('leaves the entry in error when the module throws while loading, with the line', async () => {
    const client = await write(
      [
        'const value = 1',
        'throw new Error("boom at load")',
        'export default function () {}',
      ].join('\n'),
    )
    const { snapshot, detail } = failure(client)

    expect(snapshot?.status).toBe('error')
    expect(detail?.phase).toBe('load')
    expect(detail?.message).toBe('boom at load')
    expect(detail?.line).toBe(2)
  })

  it('leaves the entry in error when setup throws, with the line', async () => {
    const client = await write(
      [
        'export default function () {',
        '  throw new Error("boom in setup")',
        '}',
      ].join('\n'),
    )
    const { snapshot, detail } = failure(client)

    expect(snapshot?.status).toBe('error')
    expect(detail?.phase).toBe('setup')
    expect(detail?.message).toBe('boom in setup')
    expect(detail?.line).toBe(2)
  })

  it('leaves the entry in error when the first call into it throws', async () => {
    const client = await write(
      [
        'export default async function ({ stubs }) {',
        "  await stubs.expose({ name: 'run', handler: 'run' })",
        '}',
        'export function run() {',
        '  throw new Error("boom on first call")',
        '}',
      ].join('\n'),
    )
    expect(client.inspect().find((one) => one.id === 'a')?.status).toBe(
      'active',
    )

    const run = client.getContext(callsKey)?.get('run')
    await expect(run?.(undefined)).rejects.toThrow('boom on first call')

    const { snapshot, detail } = failure(client)
    expect(snapshot?.status).toBe('error')
    expect(detail?.phase).toBe('call')
    expect(detail?.message).toBe('boom on first call')
    expect(detail?.line).toBe(5)
    // Nothing it registered survives.
    expect(client.getContext(callsKey)?.size).toBe(0)
  })

  it('keeps running after it has answered once, so a bad argument is not fatal', async () => {
    const client = await write(
      [
        'export default async function ({ stubs }) {',
        "  await stubs.expose({ name: 'run', handler: 'run' })",
        '}',
        'export function run(n) {',
        '  if (n < 0) throw new Error("negative")',
        '  return n + 1',
        '}',
      ].join('\n'),
    )
    const run = client.getContext(callsKey)!.get('run')!

    await expect(run(1)).resolves.toBe(2)
    await expect(run(-1)).rejects.toThrow('negative')
    expect(client.inspect().find((one) => one.id === 'a')?.status).toBe(
      'active',
    )
  })

  it('reports every failure in one shape, so one recovery loop covers them all', async () => {
    const sources = [
      'export default function ( {',
      'throw new Error("load")\nexport default function () {}',
      'export default function () { throw new Error("setup") }',
    ]
    for (const source of sources) {
      const client = await write(source)
      const { detail } = failure(client)
      expect(Object.keys(detail ?? {})).toContain('phase')
      expect(typeof detail?.message).toBe('string')
    }
  })
})

describe('the source checker seam', () => {
  it('starts source as written when no checker is provided', async () => {
    const client = await write(
      "export default async function ({ stubs }) { await stubs.expose({ name: 'run', handler: 'run' }) }\nexport const run = () => 'ran'",
    )
    expect(client.inspect().find((one) => one.id === 'a')?.status).toBe(
      'active',
    )
    await expect(
      client.getContext(callsKey)?.get('run')?.(undefined),
    ).resolves.toBe('ran')
  })

  it('starts what the checker returns, not what was written', async () => {
    const client = await write(
      [
        "export default async function ({ stubs }) { await stubs.expose({ name: 'run', handler: 'run' }) }",
        'export const run = (n: number) => n',
      ].join('\n'),
      markerChecker,
    )
    expect(client.inspect().find((one) => one.id === 'a')?.status).toBe(
      'active',
    )
    await expect(client.getContext(callsKey)?.get('run')?.(7)).resolves.toBe(7)
  })

  it('does not ask the host to start source the checker rejected', async () => {
    const client = await write(
      ['export default function () {', '  const x = NOPE', '}'].join('\n'),
      markerChecker,
    )
    const { snapshot, detail } = failure(client)

    expect(snapshot?.status).toBe('error')
    expect(detail?.phase).toBe('check')
    expect(detail?.line).toBe(2)
    expect(detail?.column).toBe(3)
    expect(detail?.diagnostics).toEqual([
      { message: "'NOPE' is not assignable", line: 2, column: 3 },
    ])
  })

  it('checks against the declarations of exactly the stubs the entry was granted', async () => {
    const seen: Array<string> = []
    const client = createClient({
      plugins: [
        { id: 'registry', plugin: registry },
        {
          id: 'checker',
          plugin: createPlugin({
            name: 'checker',
            provides: [sourceCheckerKey],
            setup(instance) {
              instance.provide(sourceCheckerKey, {
                check({ declarations, source }) {
                  seen.push(declarations)
                  return { code: source }
                },
              })
            },
          }),
        },
        {
          id: 'granted',
          source: 'export default function () {}',
          stubs: [exposeStub],
        },
        { id: 'bare', source: 'export default function () {}' },
      ],
    })
    await client.settled()

    expect(seen).toEqual([exposeStub.declarations, ''])
  })
})
