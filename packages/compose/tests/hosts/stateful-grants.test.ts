import { describe, expect, test, vi } from 'vitest'
import { createClient, createStub, scheduleStub, storageStub } from '../../src'

// Keep the grant object in module scope where exported handlers can use it.
const storedSource = (extra = '') => `
let store
export default async ({ options, stubs }) => {
  store = stubs.storage
  const count = (await store.get('count')) ?? 0
  await store.set('count', count + options.step)
}
export const count = () => store.get('count')
${extra}
`

describe('in-process stateful grants', () => {
  test('storage survives restart and source rewrite, then remove destroys it', async () => {
    const client = createClient({
      plugins: [
        {
          id: 'stateful-test',
          source: storedSource(),
          options: { step: 1 },
          stubs: [storageStub],
        },
      ],
    })
    await client.settled()
    expect(await client.callSource('stateful-test', 'count')).toBe(1)

    await client.setOptions('stateful-test', { step: 2 })
    expect(await client.callSource('stateful-test', 'count')).toBe(3)

    await client.setPluginList([
      {
        id: 'stateful-test',
        source: storedSource('// rewritten'),
        options: { step: 10 },
        stubs: [storageStub],
      },
    ])
    expect(await client.callSource('stateful-test', 'count')).toBe(13)

    await client.removePlugin('stateful-test')
    await client.addPlugin({
      id: 'stateful-test',
      source: storedSource(),
      options: { step: 4 },
      stubs: [storageStub],
    })
    expect(await client.callSource('stateful-test', 'count')).toBe(4)
    await client.destroy()
  })

  test('a schedule calls a named export with no source call in flight', async () => {
    const fired = vi.fn()
    const note = createStub({
      name: 'note',
      declarations: 'declare const note: (input: unknown) => Promise<void>',
      handler: ({ input }) => fired(input),
    })
    const client = createClient({
      plugins: [
        {
          id: 'scheduled-test',
          source: `
let note
export default async ({ stubs }) => {
  note = stubs.note
  await stubs.schedule.at(Date.now() + 10, 'wake')
}
export const wake = (input) => note(input)
`,
          stubs: [scheduleStub, note],
        },
      ],
    })
    await client.settled()

    await vi.waitFor(() => expect(fired).toHaveBeenCalledTimes(1))
    expect(fired.mock.calls[0]?.[0]).toEqual({
      scheduledAt: expect.any(Number),
    })
    await client.removePlugin('scheduled-test')
  })
})
