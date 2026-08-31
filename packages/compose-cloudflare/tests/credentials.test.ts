import { env } from 'cloudflare:test'
import { createClient } from '@tanstack/compose'
import { credentialsKey, credentialsPlugin } from '@tanstack/compose-agent'
import { describe, expect, it } from 'vitest'
import { bindingCredentials } from '../src/index'

describe('credentials from a Worker binding', () => {
  it('reads a string binding by name and answers undefined for anything else', () => {
    const source = bindingCredentials(env)

    expect(source.get('MODEL_CREDENTIAL')).toBe('binding-value')
    expect(source.get('NOT_BOUND')).toBeUndefined()
    // A Worker Loader is a binding, but it is not a credential.
    expect(source.get('LOADER')).toBeUndefined()
  })

  it('is the source a Worker gives the credentials plugin', async () => {
    const client = createClient({
      plugins: [
        {
          id: 'credentials',
          plugin: credentialsPlugin,
          options: { source: bindingCredentials(env) },
        },
      ],
    })
    await client.settled()

    const credentials = client.getContext(credentialsKey)!
    expect(credentials.has('MODEL_CREDENTIAL')).toBe(true)
    expect(credentials.get('MODEL_CREDENTIAL')).toBe('binding-value')
    expect(credentials.has('NOT_BOUND')).toBe(false)

    await client.destroy()
  })

  it('does not consult a process environment', () => {
    const process = (globalThis as { process?: { env?: unknown } }).process
    // Whatever this runtime does or does not have, the source answers from the
    // bindings it was handed and from nothing else.
    expect(bindingCredentials({}).get('MODEL_CREDENTIAL')).toBeUndefined()
    expect(
      bindingCredentials({ ONLY_HERE: 'from the binding' }).get('ONLY_HERE'),
    ).toBe('from the binding')
    expect(
      (process?.env as Record<string, unknown> | undefined)?.ONLY_HERE,
    ).toBeUndefined()
  })
})
