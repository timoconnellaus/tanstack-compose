import { createClient, createPlugin } from '@tanstack/compose'
import { describe, expect, it } from 'vitest'
import {
  agentKey,
  createTool,
  loopPlugin,
  modelKey,
  scriptedModelPlugin,
  sessionAppendedEvent,
  sessionKey,
  sessionPlugin,
  toolsPlugin,
} from '../src/index'
import { buildAgent, deferred, kindsOf } from './helpers/agent'
import { anyValidator } from './helpers/validator'
import type { ModelChunk, ModelProvider } from '../src/index'

/** A provider that streams two pieces with a gate the test opens by hand. */
const gatedModel = (gate: Promise<void>, onFirst: () => void) =>
  createPlugin({
    name: 'gated-model',
    provides: [modelKey],
    setup(instance) {
      const provider: ModelProvider = {
        name: 'gated',
        stream: () =>
          (async function* stream(): AsyncGenerator<ModelChunk> {
            yield { kind: 'text', text: 'A' }
            onFirst()
            await gate
            yield { kind: 'text', text: 'B' }
          })(),
      }
      instance.provide(modelKey, provider)
    },
  })

describe('E. Model providers', () => {
  it('chunks are appended as they stream and the assistant message is appended when it ends', async () => {
    const gate = deferred()
    const first = deferred()

    const client = createClient({
      plugins: [
        { id: 'session', plugin: sessionPlugin },
        { id: 'model', plugin: gatedModel(gate.promise, first.resolve) },
        { id: 'loop', plugin: loopPlugin },
      ],
    })
    await client.settled()
    const agent = client.getContext(agentKey)!
    const session = client.getContext(sessionKey)!

    agent.send('stream please')
    await first.promise

    // Mid-stream: the first chunk is already in the log, the message is not.
    expect(kindsOf(session.snapshot())).toEqual([
      'turn-opened',
      'input',
      'step-opened',
      'chunk',
    ])

    gate.resolve()
    await agent.idle()
    expect(session.snapshot().at(-3)).toMatchObject({
      kind: 'assistant',
      text: 'AB',
    })
    await client.destroy()

    // A stream that fails still leaves the complete message behind.
    const failing = await buildAgent({
      script: [{ chunks: ['half'], error: 'the stream broke' }],
    })
    failing.agent.send('go')
    await failing.agent.idle()
    expect(
      failing.session.snapshot().find((entry) => entry.kind === 'assistant'),
    ).toMatchObject({ text: 'half' })
    await failing.client.destroy()

    // And so does a stream that is cancelled.
    const running = deferred()
    const hang = createTool({
      name: 'hang',
      description: 'Never finishes on its own',
      validator: anyValidator,
      execute: () => {
        running.resolve()
        return new Promise<string>(() => {})
      },
    })
    const cancelled = await buildAgent({
      tools: [hang],
      script: [
        { chunks: ['said this much'], toolCalls: [{ name: 'hang', args: {} }] },
      ],
    })
    cancelled.agent.send('go')
    await running.promise
    await cancelled.agent.cancel()
    expect(
      cancelled.session.snapshot().find((entry) => entry.kind === 'assistant'),
    ).toMatchObject({ text: 'said this much' })
    await cancelled.client.destroy()
  })

  it('the provider is chosen by the key alone and can be swapped between steps', async () => {
    const released = deferred()
    const running = deferred()
    const wait = createTool({
      name: 'wait',
      description: 'Hold the turn open between steps',
      validator: anyValidator,
      execute: async () => {
        running.resolve()
        await released.promise
        return 'held'
      },
    })

    const client = createClient({
      plugins: [
        { id: 'session', plugin: sessionPlugin },
        { id: 'tools', plugin: toolsPlugin, options: { tools: [wait] } },
        {
          id: 'model',
          plugin: scriptedModelPlugin,
          options: {
            name: 'before',
            script: [{ toolCalls: [{ name: 'wait', args: {} }] }],
          },
        },
        { id: 'loop', plugin: loopPlugin },
      ],
    })
    await client.settled()
    const agent = client.getContext(agentKey)!
    const session = client.getContext(sessionKey)!
    const names: Array<string> = []
    client.on(sessionAppendedEvent, () => {
      names.push(client.getContext(modelKey)!.name)
    })

    agent.send('go')
    await running.promise
    expect(client.getContext(modelKey)!.name).toBe('before')

    // The swap is one plugin-list edit; nothing else in the list changes.
    await client.setOptions('model', {
      name: 'after',
      script: [{ chunks: ['answered by the second provider'] }],
    })
    expect(client.getContext(modelKey)!.name).toBe('after')
    // The loop was not restarted: the agent handle is the same object.
    expect(client.getContext(agentKey)).toBe(agent)

    released.resolve()
    await agent.idle()

    expect(session.messages().at(-1)).toEqual({
      role: 'assistant',
      content: 'answered by the second provider',
      toolCalls: [],
    })
    expect(names.at(-1)).toBe('after')
    expect(session.snapshot().at(-1)).toMatchObject({
      kind: 'turn-closed',
      reason: 'complete',
    })

    await client.destroy()
  })

  it('the scripted provider replays responses, tool calls and mid-stream failures', async () => {
    const echo = createTool({
      name: 'echo',
      description: 'Echo',
      validator: anyValidator,
      execute: () => 'echoed',
    })

    const { client, agent, session } = await buildAgent({
      tools: [echo],
      script: [
        {
          chunks: ['one', ' two'],
          toolCalls: [{ id: 'named', name: 'echo', args: { a: 1 } }],
        },
        { chunks: ['before the break'], error: 'the stream broke' },
      ],
    })

    agent.send('go')
    await agent.idle()

    expect(session.messages()).toEqual([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: 'one two',
        toolCalls: [{ id: 'named', name: 'echo', args: { a: 1 } }],
      },
      {
        role: 'tool',
        callId: 'named',
        name: 'echo',
        content: 'echoed',
        isError: false,
      },
      { role: 'assistant', content: 'before the break', toolCalls: [] },
    ])
    expect(
      session.snapshot().filter((entry) => entry.kind === 'error'),
    ).toMatchObject([{ scope: 'model', message: 'the stream broke' }])

    // Running past the end of the script is a model error, not a silent repeat.
    agent.send('again')
    await agent.idle()
    expect(
      session
        .snapshot()
        .filter((entry) => entry.kind === 'error')
        .at(-1),
    ).toMatchObject({
      scope: 'model',
      message: expect.stringContaining('no response for request 3'),
    })

    await client.destroy()
  })
})
