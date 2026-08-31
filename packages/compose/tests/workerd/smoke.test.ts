import { describe, expect, it } from 'vitest'
import { createClient, createContextKey, createPlugin } from '../../src/index'

const greetingKey = createContextKey<string>('greeting')

describe('I. Runtime and packaging — workerd', () => {
  it('the kernel assembles, provides and cleans up under workerd', async () => {
    expect(
      typeof navigator === 'undefined' ? '' : navigator.userAgent,
    ).toContain('Cloudflare-Workers')

    const cleaned: Array<string> = []
    const provider = createPlugin({
      name: 'provider',
      provides: [greetingKey],
      setup(instance) {
        instance.provide(greetingKey, 'hello from workerd')
        instance.cleanup(() => {
          cleaned.push('provider')
        })
      },
    })
    const consumer = createPlugin({
      name: 'consumer',
      deps: [greetingKey],
      setup(instance) {
        cleaned.push(`saw:${instance.context.get(greetingKey)}`)
      },
    })

    const client = createClient({
      plugins: [
        { id: 'provider', plugin: provider },
        { id: 'consumer', plugin: consumer },
      ],
    })
    await client.settled()
    expect(client.inspect().map((entry) => entry.status)).toEqual([
      'active',
      'active',
    ])

    await client.destroy()
    expect(cleaned).toEqual(['saw:hello from workerd', 'provider'])
    expect(client.inspect()).toEqual([])
  })
})
