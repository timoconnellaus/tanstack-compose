import { createClient } from '@tanstack/compose'
import { describe, expect, it } from 'vitest'
import {
  agentKey,
  createTool,
  loopPlugin,
  modelsPlugin,
  promptPlugin,
  scriptedModelPlugin,
  sessionKey,
  sessionPlugin,
  toolsPlugin,
} from '@tanstack/compose-example-agent-runtime'
import type { StandardSchemaV1 } from '@tanstack/compose'

const anyArgs: StandardSchemaV1<unknown, Record<string, unknown>> = {
  '~standard': {
    version: 1,
    vendor: 'compose-agent-tests',
    validate: (value: unknown) => ({
      value: (value ?? {}) as Record<string, unknown>,
    }),
  },
}

describe('Runtime — workerd', () => {
  it('an agent runs a turn under workerd', async () => {
    expect(
      typeof navigator === 'undefined' ? '' : navigator.userAgent,
    ).toContain('Cloudflare-Workers')

    const ping = createTool({
      name: 'ping',
      description: 'Answer with pong',
      validator: anyArgs,
      execute: () => 'pong',
    })

    const client = createClient({
      plugins: [
        { id: 'session', plugin: sessionPlugin },
        { id: 'tools', plugin: toolsPlugin, options: { tools: [ping] } },
        { id: 'prompt', plugin: promptPlugin },
        { id: 'models', plugin: modelsPlugin },
        {
          id: 'model',
          plugin: scriptedModelPlugin,
          options: {
            script: [
              { toolCalls: [{ name: 'ping', args: {} }] },
              { chunks: ['pong received'] },
            ],
          },
        },
        { id: 'loop', plugin: loopPlugin },
      ],
    })
    await client.settled()

    const agent = client.getContext(agentKey)!
    const session = client.getContext(sessionKey)!
    agent.send('ping please')
    await agent.idle()

    expect(session.messages()).toEqual([
      { role: 'user', content: 'ping please' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'ping', args: {} }],
      },
      {
        role: 'tool',
        callId: 'call-1',
        name: 'ping',
        content: 'pong',
        isError: false,
      },
      { role: 'assistant', content: 'pong received', toolCalls: [] },
    ])

    await client.destroy()
    expect(client.inspect()).toEqual([])
  })
})
