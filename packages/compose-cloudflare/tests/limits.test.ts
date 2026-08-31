import { describe, expect, it } from 'vitest'
import { createClient, createStub, sourceErrorOf } from '@tanstack/compose'
import { testHost } from './helpers/host'

const noteStub = createStub<string, void>({
  name: 'note',
  declarations: 'declare const note: (message: string) => Promise<void>',
  handler: () => {},
})

/**
 * A setup that never finishes. It waits rather than spins: a plugin that never
 * yields is what the wall-clock limit is for, but a busy loop wedges the local
 * runtime for the whole test run instead of being cut off, so the suite proves
 * the limit with code that hangs politely. See DESIGN.md.
 */
const neverFinishes = `
export default function setup() {
  return new Promise((resolve) => setTimeout(resolve, 600000))
}
`

const answers = `
export default async function setup({ stubs }) {
  await stubs.note('up')
}

export async function ping() {
  return 'pong'
}
`

describe('code that does not finish', () => {
  it('ends in error naming the wall-clock limit, leaving the client working', async () => {
    let ping: ((input: unknown) => Promise<unknown>) | undefined
    const exposeStub = createStub<void, void>({
      name: 'note',
      declarations: 'declare const note: (message: string) => Promise<void>',
      handler: ({ call }) => {
        ping = (input) => call('ping', input)
      },
    })

    const client = createClient({
      hosts: { cloudflare: testHost({ callTimeoutMs: 100 }) },
      plugins: [
        {
          id: 'hung',
          source: neverFinishes,
          host: 'cloudflare',
          stubs: [noteStub],
        },
        {
          id: 'busy',
          source: answers,
          host: 'cloudflare',
          stubs: [exposeStub],
        },
      ],
    })
    await client.settled()

    const [hung, busy] = client.inspect()
    expect(hung?.status).toBe('error')
    expect(String((hung?.error as Error).message)).toContain(
      'exceeded the 100ms callTimeoutMs wall-clock limit',
    )

    // The client and its other instances are untouched.
    expect(busy?.status).toBe('active')
    await expect(ping?.(null)).resolves.toBe('pong')

    await client.destroy()
  })

  it('times out a call into a plugin that has already started', async () => {
    let hang: ((input: unknown) => Promise<unknown>) | undefined
    let ping: ((input: unknown) => Promise<unknown>) | undefined
    const exposeStub = createStub<void, void>({
      name: 'note',
      declarations: 'declare const note: (message: string) => Promise<void>',
      handler: ({ call }) => {
        hang = (input) => call('hang', input)
        ping = (input) => call('ping', input)
      },
    })

    const client = createClient({
      hosts: { cloudflare: testHost({ callTimeoutMs: 100 }) },
      plugins: [
        {
          id: 'slow',
          host: 'cloudflare',
          stubs: [exposeStub],
          source: `
export default async function setup({ stubs }) {
  await stubs.note('up')
}

export async function ping() {
  return 'pong'
}

export function hang() {
  return new Promise((resolve) => setTimeout(resolve, 600000))
}
`,
        },
      ],
    })
    await client.settled()

    // Answer once, so the plugin is past the first call the kernel promotes.
    await expect(ping?.(null)).resolves.toBe('pong')
    await expect(hang?.(null)).rejects.toThrow(
      'exceeded the 100ms callTimeoutMs wall-clock limit',
    )
    // One call running out of wall clock is not the instance's whole story.
    expect(client.inspect()[0]?.status).toBe('active')

    await client.destroy()
  })

  it('names the limit as the source of the failure, not the plugin', async () => {
    const client = createClient({
      hosts: { cloudflare: testHost({ callTimeoutMs: 100 }) },
      plugins: [
        {
          id: 'hung',
          source: neverFinishes,
          host: 'cloudflare',
          stubs: [noteStub],
        },
      ],
    })
    await client.settled()

    // The limit is the host's, so it is not a fault in the written source and
    // carries no source-error detail.
    expect(sourceErrorOf(client.inspect()[0]?.error)).toBeUndefined()

    await client.destroy()
  })
})
