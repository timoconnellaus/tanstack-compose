import { createClient } from '@tanstack/compose'
import { describe, expect, it, vi } from 'vitest'
import {
  agentKey,
  createTool,
  loopPlugin,
  promptKey,
  promptPlugin,
  promptSectionPlugin,
  requestAction,
  scriptedModelPlugin,
  sessionKey,
  sessionPlugin,
  toolsKey,
  toolsPlugin,
  toolsetPlugin,
} from '../src/index'
import { buildAgent, deferred } from './helpers/agent'
import { lookupPlugin, lookupTool } from './helpers/other-package'
import { anyValidator } from './helpers/validator'

describe('A. Everything is a plugin', () => {
  it('every part of the agent is a plugin that can be removed and replaced mid-conversation', async () => {
    for (const plugin of [
      sessionPlugin,
      toolsPlugin,
      promptPlugin,
      scriptedModelPlugin,
      loopPlugin,
    ]) {
      expect(plugin.type).toBe('compose/plugin')
    }

    const running = deferred()
    const released = deferred()
    const wait = createTool({
      name: 'wait',
      description: 'Hold the turn open',
      validator: anyValidator,
      execute: async () => {
        running.resolve()
        await released.promise
        return 'held'
      },
    })
    const extra = createTool({
      name: 'extra',
      description: 'Added while a conversation is open',
      validator: anyValidator,
      execute: () => 'extra ran',
    })

    const { client, agent, session } = await buildAgent({
      tools: [wait],
      sections: [{ name: 'base', text: 'Before.' }],
      script: [
        { toolCalls: [{ name: 'wait', args: {} }] },
        { toolCalls: [{ name: 'extra', args: {} }] },
        { chunks: ['finished'] },
      ],
    })
    const requests: Array<{ system: string; tools: Array<string> }> = []
    client.use(requestAction, ({ input, next }) => {
      requests.push({
        system: input.system,
        tools: input.tools.map((tool) => tool.name),
      })
      return next(input)
    })

    agent.send('go')
    await running.promise

    // Reconfigured, added to and swapped, all while the turn is open.
    await client.setOptions('prompt', {
      sections: [{ name: 'base', text: 'After.' }],
    })
    await client.addPlugin({
      id: 'extra-tools',
      plugin: toolsetPlugin,
      options: { tools: [extra] },
    })
    await client.addPlugin({
      id: 'extra-prompt',
      plugin: promptSectionPlugin,
      options: { sections: [{ name: 'added', text: 'Added.' }] },
    })

    released.resolve()
    await agent.idle()

    expect(requests).toEqual([
      { system: 'Before.', tools: ['wait'] },
      { system: 'After.\n\nAdded.', tools: ['wait', 'extra'] },
      { system: 'After.\n\nAdded.', tools: ['wait', 'extra'] },
    ])
    expect(session.snapshot().at(-1)).toMatchObject({
      kind: 'turn-closed',
      reason: 'complete',
    })

    // Removing an entry takes its contribution away again.
    await client.removePlugin('extra-tools')
    await client.removePlugin('extra-prompt')
    expect(
      client
        .getContext(toolsKey)!
        .list()
        .map((tool) => tool.name),
    ).toEqual(['wait'])
    expect(client.getContext(promptKey)!.assemble()).toBe('After.')

    // And every part can be removed outright, leaving nothing behind.
    await client.setPluginList([])
    expect(client.inspect()).toEqual([])
    expect(client.getContext(agentKey)).toBeUndefined()
    expect(client.getContext(sessionKey)).toBeUndefined()

    await client.destroy()
  })

  it('a consumer declares the keys it needs and never imports a provider', async () => {
    // `lookupPlugin` is written as if it lived in another package: it declares
    // `toolsKey` as a dep and imports no provider at all.
    expect(lookupPlugin.deps).toEqual([toolsKey])
    expect(lookupPlugin.provides).toEqual([])

    const client = createClient({
      plugins: [
        { id: 'session', plugin: sessionPlugin },
        { id: 'tools', plugin: toolsPlugin },
        {
          id: 'model',
          plugin: scriptedModelPlugin,
          options: {
            script: [
              { toolCalls: [{ name: 'lookup', args: { query: 'cats' } }] },
              { chunks: ['four'] },
            ],
          },
        },
        { id: 'loop', plugin: loopPlugin },
        { id: 'consumer', plugin: lookupPlugin },
      ],
    })
    await client.settled()
    expect(client.getContext(toolsKey)!.get('lookup')).toBe(lookupTool)

    const agent = client.getContext(agentKey)!
    agent.send('find cats')
    await agent.idle()
    expect(client.getContext(sessionKey)!.messages().at(-2)).toMatchObject({
      role: 'tool',
      name: 'lookup',
      content: '{"found":4}',
    })

    // Unloading the consumer takes its tool with it.
    await client.removePlugin('consumer')
    expect(client.getContext(toolsKey)!.list()).toEqual([])

    await client.destroy()
  })

  it("a conversation runs on the package's plugins and a scripted model, with no network", async () => {
    const fetchSpy = vi.fn()
    const original = globalThis.fetch
    globalThis.fetch = fetchSpy

    try {
      const { client, agent, session } = await buildAgent({
        tools: [lookupTool],
        sections: [{ name: 'base', text: 'Be helpful.' }],
        script: [
          { toolCalls: [{ name: 'lookup', args: { query: 'cats' } }] },
          { chunks: ['Four letters.'] },
        ],
      })

      // Five entries: session, tools, prompt, model, loop. Nothing else.
      expect(client.pluginList.state.map((entry) => entry.id)).toEqual([
        'session',
        'tools',
        'prompt',
        'model',
        'loop',
      ])

      agent.send('find cats')
      await agent.idle()

      expect(session.messages().at(-1)).toEqual({
        role: 'assistant',
        content: 'Four letters.',
        toolCalls: [],
      })
      expect(fetchSpy).not.toHaveBeenCalled()

      await client.destroy()
    } finally {
      globalThis.fetch = original
    }
  })
})
