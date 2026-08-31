import { describe, expect, it } from 'vitest'
import { createClient, createStub } from '@tanstack/compose'
import { countingLoader, compatibilityDate, testHost } from './helpers/host'
import { createCloudflareHost } from '../src/index'

const source = (greeting: string) => `
export default async function setup({ stubs }) {
  await stubs.note('${greeting}')
}
`

const noteStub = createStub<string, void>({
  name: 'note',
  declarations: 'declare const note: (message: string) => Promise<void>',
  handler: () => {},
})

describe('which isolate a written plugin lands in', () => {
  it('reuses one isolate when nothing about the plugin changed', async () => {
    const counting = countingLoader()
    const client = createClient({
      hosts: {
        cloudflare: createCloudflareHost({
          loader: counting.loader,
          compatibilityDate,
        }),
      },
      plugins: [
        {
          id: 'greeter',
          source: source('hello'),
          host: 'cloudflare',
          stubs: [noteStub],
        },
      ],
    })
    await client.settled()

    await client.removePlugin('greeter')
    await client.addPlugin({
      id: 'greeter',
      source: source('hello'),
      host: 'cloudflare',
      stubs: [noteStub],
    })

    expect(counting.ids).toHaveLength(2)
    expect(counting.ids[0]).toBe(counting.ids[1])
    expect(counting.loads).toHaveLength(1)

    await client.destroy()
  })

  it('takes a new isolate when the source, the options or the grants change', async () => {
    const counting = countingLoader()
    const entry = {
      id: 'greeter',
      host: 'cloudflare',
      stubs: [noteStub],
      source: source('hello'),
      options: { volume: 1 },
    }
    const client = createClient({
      hosts: {
        cloudflare: createCloudflareHost({
          loader: counting.loader,
          compatibilityDate,
        }),
      },
      plugins: [entry],
    })
    await client.settled()

    await client.setOptions('greeter', { volume: 2 })
    await client.removePlugin('greeter')
    await client.addPlugin({ ...entry, source: source('goodbye') })

    expect(new Set(counting.ids).size).toBe(3)
    expect(counting.loads).toHaveLength(3)

    await client.destroy()
  })

  it('keeps two instances of the same source in isolates of their own', async () => {
    const counting = countingLoader()
    const entry = (id: string) => ({
      id,
      source: source('hello'),
      host: 'cloudflare',
      stubs: [noteStub],
    })
    const client = createClient({
      hosts: {
        cloudflare: createCloudflareHost({
          loader: counting.loader,
          compatibilityDate,
        }),
      },
      plugins: [entry('one'), entry('two')],
    })
    await client.settled()

    expect(new Set(counting.ids).size).toBe(2)
    expect(counting.ids[0]).toContain('one:')
    expect(counting.ids[1]).toContain('two:')

    await client.destroy()
  })

  it('is a host over one loader, whichever client asks it', async () => {
    const host = testHost()
    expect(host.name).toBe('cloudflare')
  })
})
