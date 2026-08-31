import { describe, expect, it } from 'vitest'
import { exports as workerExports } from 'cloudflare:workers'
import { createClient, createStub } from '@tanstack/compose'
import { testHost } from './helpers/host'
import type { StubAnswer, StubProps } from '../src/index'

/** A written plugin that hands the client a way to call its stub later. */
const source = `
let held

export default async function setup({ stubs }) {
  held = stubs
  await stubs.expose('poke')
  return async () => {
    await stubs.note('cleanup ran')
  }
}

export async function poke(message) {
  await held.note(message)
  return 'noted'
}
`

describe('removing a hosted instance', () => {
  it('revokes its stubs before it stops, and reports done only once released', async () => {
    const notes: Array<string> = []
    const noteStub = createStub<string, void>({
      name: 'note',
      declarations: 'declare const note: (message: string) => Promise<void>',
      handler: ({ input }) => {
        notes.push(input)
      },
    })

    let poke: ((input: unknown) => Promise<unknown>) | undefined
    const exposeStub = createStub<string, void>({
      name: 'expose',
      declarations: 'declare const expose: (name: string) => Promise<void>',
      handler: ({ input, call }) => {
        poke = (argument) => call(input, argument)
      },
    })

    const client = createClient({
      hosts: { cloudflare: testHost({ callTimeoutMs: 2000 }) },
      plugins: [
        {
          id: 'poker',
          source,
          host: 'cloudflare',
          stubs: [noteStub, exposeStub],
        },
      ],
    })
    await client.settled()

    await expect(poke?.('before')).resolves.toBe('noted')
    expect(notes).toEqual(['before'])

    await client.removePlugin('poker')

    // The cleanup the module returned ran after its stubs were revoked, so
    // nothing it did reached the client.
    expect(notes).toEqual(['before'])
    expect(client.inspect()).toEqual([])
    expect(client.resources('poker')).toBeUndefined()
  })

  it('fails a stub call attempted after revocation rather than landing it', async () => {
    const notes: Array<string> = []
    const host = testHost({ callTimeoutMs: 2000 })
    const started = await host.start({
      instanceId: 'poker',
      code: 'export default async function setup() {}',
      options: {},
      stubs: {
        note: (input) => {
          notes.push(input as string)
          return Promise.resolve()
        },
      },
    })

    // The very loopback the isolate holds in its `env`, minted the same way.
    const loopback = (
      workerExports as unknown as {
        ComposeStubLoopback: (options: { props: StubProps }) => {
          stubCall: (input: unknown) => Promise<StubAnswer>
        }
      }
    ).ComposeStubLoopback({
      props: { hostId: 'cloudflare', instanceId: 'poker', stub: 'note' },
    })

    await expect(loopback.stubCall('before')).resolves.toMatchObject({
      ok: true,
    })
    expect(notes).toEqual(['before'])

    await started.stop()

    await expect(loopback.stubCall('after')).resolves.toEqual({
      ok: false,
      message: expect.stringContaining(
        'was revoked when instance "poker" stopped',
      ),
    })
    expect(notes).toEqual(['before'])
  })
})
