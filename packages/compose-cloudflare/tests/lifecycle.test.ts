import { describe, expect, it } from 'vitest'
import { createClient, createStub } from '@tanstack/compose'
import { testHost } from './helpers/host'

const source = `
export default async function setup({ id, options, stubs }) {
  await stubs.note('start:' + id + ':' + options.label)
  return async () => {
    // Cleanup runs after the stubs are revoked, so it holds nothing outside.
  }
}

export async function shout(input) {
  return String(input).toUpperCase()
}
`

describe('a written plugin in a Dynamic Worker', () => {
  it('starts, is called and is stopped as an ordinary instance', async () => {
    const notes: Array<string> = []
    const noteStub = createStub<string, void>({
      name: 'note',
      declarations: 'declare const note: (message: string) => Promise<void>',
      handler: ({ input }) => {
        notes.push(input)
      },
    })

    let shout: ((input: unknown) => Promise<unknown>) | undefined
    const exposeStub = createStub<string, void>({
      name: 'expose',
      declarations: 'declare const expose: (name: string) => Promise<void>',
      handler: ({ input, call }) => {
        shout = (argument) => call(input, argument)
      },
    })

    const client = createClient({
      hosts: { cloudflare: testHost() },
      plugins: [
        {
          id: 'shouter',
          source: source.replace(
            'return async () => {',
            "await stubs.expose('shout')\n  return async () => {",
          ),
          host: 'cloudflare',
          stubs: [noteStub, exposeStub],
          options: { label: 'one' },
        },
      ],
    })
    await client.settled()

    expect(client.inspect()[0]?.status).toBe('active')
    expect(notes).toEqual(['start:shouter:one'])
    await expect(shout?.('hi')).resolves.toBe('HI')

    await client.destroy()
    expect(client.inspect()).toEqual([])
  })
})
