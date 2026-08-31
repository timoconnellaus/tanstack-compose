import { describe, expect, it } from 'vitest'
import { createClient, createStub, sourceErrorOf } from '@tanstack/compose'
import { testHost } from './helpers/host'
import type { SourceError } from '@tanstack/compose'

const noteStub = createStub<string, void>({
  name: 'note',
  declarations: 'declare const note: (message: string) => Promise<void>',
  handler: () => {},
})

/** Start one written plugin and report what the client made of it. */
async function startFailing(source: string): Promise<{
  message: string
  detail: SourceError | undefined
  siblingIsFine: boolean
}> {
  const client = createClient({
    hosts: { cloudflare: testHost({ callTimeoutMs: 2000 }) },
    plugins: [
      { id: 'broken', source, host: 'cloudflare', stubs: [noteStub] },
      {
        id: 'fine',
        source: 'export default async function setup() {}',
        host: 'cloudflare',
        stubs: [noteStub],
      },
    ],
  })
  await client.settled()

  const [broken, fine] = client.inspect()
  expect(broken?.status).toBe('error')
  const result = {
    message: String((broken?.error as Error).message),
    detail: sourceErrorOf(broken?.error),
    siblingIsFine: fine?.status === 'active',
  }
  await client.destroy()
  return result
}

describe('a written plugin that fails', () => {
  it('reports source that does not parse, with the original message', async () => {
    const failure = await startFailing('export default function ( {')

    expect(failure.detail?.phase).toBe('parse')
    expect(failure.message).toMatch(/Unexpected|SyntaxError|expected/i)
    expect(failure.siblingIsFine).toBe(true)
  })

  it('reports a module that throws while it evaluates', async () => {
    const failure = await startFailing(
      "throw new Error('bad module')\nexport default function setup() {}",
    )

    expect(failure.detail?.phase).toBe('load')
    expect(failure.detail?.message).toContain('bad module')
    expect(failure.siblingIsFine).toBe(true)
  })

  it('reports a module with no setup to run', async () => {
    const failure = await startFailing('export const nothing = 1')

    expect(failure.detail?.phase).toBe('load')
    expect(failure.detail?.message).toContain(
      'must export a default setup function',
    )
  })

  it('reports a setup that throws, with the original message', async () => {
    const failure = await startFailing(
      "export default function setup() { throw new Error('setup blew up') }",
    )

    expect(failure.detail?.phase).toBe('setup')
    expect(failure.detail?.message).toBe('setup blew up')
    expect(failure.siblingIsFine).toBe(true)
  })

  it('carries a place only where the runtime named the written module', async () => {
    const running = await startFailing(
      "export default function setup() { throw new Error('setup blew up') }",
    )
    // A child isolate reports a message and a stack belonging to the loader, so
    // there is no line of the written module to point at.
    expect(running.detail).not.toHaveProperty('line')
    expect(running.detail).not.toHaveProperty('column')

    const unparsed = await startFailing('export default function ( {')
    // A module that does not parse is the exception: the load names it.
    expect(unparsed.detail?.line).toBe(1)
    expect(unparsed.detail?.column).toBe(27)
  })

  it('rejects a call to a handler it does not export, and keeps working', async () => {
    let call: ((name: string, input: unknown) => Promise<unknown>) | undefined
    const exposeStub = createStub<void, void>({
      name: 'expose',
      declarations: 'declare const expose: () => Promise<void>',
      handler: (stubCall) => {
        call = (name, input) => stubCall.call(name, input)
      },
    })

    const client = createClient({
      hosts: { cloudflare: testHost({ callTimeoutMs: 2000 }) },
      plugins: [
        {
          id: 'partial',
          host: 'cloudflare',
          stubs: [exposeStub],
          source: `
export default async function setup({ stubs }) {
  await stubs.expose()
}

export async function boom() {
  throw new Error('handler blew up')
}

export async function ok() {
  return 'still here'
}
`,
        },
      ],
    })
    await client.settled()

    // The first call is the one that can still promote a failure to the
    // instance's status, so answer once before asking for trouble.
    await expect(call?.('ok', null)).resolves.toBe('still here')
    await expect(call?.('missing', null)).rejects.toThrow(
      'has no export named "missing"',
    )
    await expect(call?.('boom', null)).rejects.toThrow('handler blew up')
    expect(client.inspect()[0]?.status).toBe('active')

    await client.destroy()
  })
})
