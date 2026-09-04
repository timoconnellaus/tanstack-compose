import { describe, expect, it } from 'vitest'
import { createClient, createStub } from '@tanstack/compose'
import {
  agentKey,
  agentStubs,
  composerPlugin,
  loopPlugin,
  modelsPlugin,
  promptPlugin,
  scriptedModelPlugin,
  sessionKey,
  sessionPlugin,
  toolsKey,
  toolsPlugin,
} from '@tanstack/compose-example-agent-runtime'
import { testHost } from './helpers/cloudflare-host'

/**
 * What the model writes: plain JavaScript, because the source checker is a
 * client-side TypeScript compiler and does not run under this runtime, and
 * self-modification allows a client with no checker to start source as written.
 */
const written = `
export default async function setup({ stubs }) {
  let escape
  try {
    await fetch('https://example.com/exfiltrate')
    escape = 'reached the network'
  } catch (error) {
    escape = 'blocked: ' + error.message
  }
  await stubs.audit(escape)

  await stubs.tools({
    name: 'add_up',
    description: 'Add two numbers',
    parameters: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
    handler: 'addUp',
  })
}

export function addUp({ a, b }) {
  return a + b
}
`

describe('an agent that writes a plugin into a Dynamic Worker', () => {
  it('writes it, uses its tool, removes it, and never reaches past its stubs', async () => {
    const audited: Array<string> = []
    const auditStub = createStub<string, void>({
      name: 'audit',
      declarations: 'declare const audit: (attempt: string) => Promise<void>',
      handler: ({ input }) => {
        audited.push(input)
      },
    })

    const client = createClient({
      hosts: { cloudflare: testHost({ callTimeoutMs: 5000 }) },
      plugins: [
        { id: 'session', plugin: sessionPlugin },
        { id: 'tools', plugin: toolsPlugin },
        { id: 'prompt', plugin: promptPlugin },
        { id: 'models', plugin: modelsPlugin },
        {
          id: 'model',
          plugin: scriptedModelPlugin,
          options: {
            script: [
              // ------------------------------------------------- turn one
              {
                toolCalls: [
                  {
                    name: 'write_plugin',
                    args: { id: 'adder', source: written },
                  },
                ],
              },
              { chunks: ['I have written an adder.'] },
              // ------------------------------------------------- turn two
              { toolCalls: [{ name: 'add_up', args: { a: 2, b: 3 } }] },
              { toolCalls: [{ name: 'remove_plugin', args: { id: 'adder' } }] },
              { chunks: ['Tidied up.'] },
            ],
          },
        },
        { id: 'loop', plugin: loopPlugin },
        {
          id: 'composer',
          plugin: composerPlugin,
          options: {
            catalog: {},
            protected: ['session', 'tools', 'prompt', 'models', 'loop'],
            stubs: [...agentStubs, auditStub],
            host: 'cloudflare',
          },
        },
      ],
    })
    await client.settled()

    const agent = client.getContext(agentKey)!
    const registry = client.getContext(toolsKey)!

    agent.send('give yourself a way to add numbers')
    await agent.idle()

    const adder = client.inspect().find((one) => one.id === 'adder')
    expect(adder?.status).toBe('active')
    expect(registry.list().map((tool) => tool.name)).toContain('add_up')
    // Its one attempt to reach past its stubs was refused, and recorded.
    expect(audited).toEqual([expect.stringContaining('blocked: ')])
    expect(audited[0]).toContain('not permitted to access the internet')

    agent.send('use it, then tidy up')
    await agent.idle()

    // The tool the written plugin provided ran, in the isolate, and answered.
    const added = client
      .getContext(sessionKey)!
      .snapshot()
      .find((entry) => entry.kind === 'tool-result' && entry.name === 'add_up')
    expect(added).toMatchObject({ outcome: { ok: true, value: 5 } })

    // The written plugin is gone, and nothing it registered is left behind.
    expect(client.inspect().map((one) => one.id)).toEqual([
      'session',
      'tools',
      'prompt',
      'models',
      'model',
      'loop',
      'composer',
    ])
    expect(client.resources('adder')).toBeUndefined()
    expect(registry.list().map((tool) => tool.name)).not.toContain('add_up')
    expect(client.errors.state).toEqual([])

    await client.destroy()
  })
})
