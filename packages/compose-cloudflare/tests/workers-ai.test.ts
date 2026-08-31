import { createClient } from '@tanstack/compose'
import {
  agentKey,
  createTool,
  loopPlugin,
  modelKey,
  modelsPlugin,
  promptPlugin,
  promptSectionPlugin,
  sessionKey,
  sessionPlugin,
  toolsPlugin,
} from '@tanstack/compose-agent'
import { describe, expect, it } from 'vitest'
import { defaultWorkersAiModel, workersAiModelPlugin } from '../src/index'
import { chatAnswer, fakeAi, frame, nativeAnswer } from './helpers/ai'
import type { StandardSchemaV1 } from '@tanstack/compose'
import type { SessionEntry } from '@tanstack/compose-agent'
import type { WorkersAiBinding } from '../src/index'

const anyArgs: StandardSchemaV1<unknown, Record<string, unknown>> = {
  '~standard': {
    version: 1,
    vendor: 'compose-cloudflare-tests',
    validate: (value: unknown) => ({
      value: (value ?? {}) as Record<string, unknown>,
    }),
  },
}

const search = createTool({
  name: 'search',
  description: 'Search the index',
  validator: anyArgs,
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  execute: ({ query }) => `found ${String(query)}`,
})

/** An agent whose only model is the binding it is given. */
const agentOn = async (
  binding: WorkersAiBinding,
  options: Record<string, unknown> = {},
) => {
  const client = createClient({
    plugins: [
      { id: 'session', plugin: sessionPlugin },
      { id: 'tools', plugin: toolsPlugin, options: { tools: [search] } },
      { id: 'prompt', plugin: promptPlugin },
      {
        id: 'tone',
        plugin: promptSectionPlugin,
        options: { sections: [{ name: 'tone', text: 'Answer briefly.' }] },
      },
      { id: 'models', plugin: modelsPlugin },
      {
        id: 'model',
        plugin: workersAiModelPlugin,
        options: { binding, ...options } as never,
      },
      { id: 'loop', plugin: loopPlugin },
    ],
  })
  await client.settled()
  return {
    client,
    agent: client.getContext(agentKey)!,
    session: client.getContext(sessionKey)!,
  }
}

/** Wait until the session holds an entry of a kind, so a test can act mid-turn. */
const until = async (
  entries: () => Array<SessionEntry>,
  kind: SessionEntry['kind'],
): Promise<void> => {
  for (let tries = 0; tries < 200; tries += 1) {
    if (entries().some((entry) => entry.kind === kind)) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`no ${kind} entry arrived`)
}

describe('a model provider over a Workers AI binding', () => {
  it('streams the answer into the session chunk by chunk and appends the assistant entry', async () => {
    const ai = fakeAi([{ frames: nativeAnswer(['Hello', ' there']) }])
    const { client, agent, session } = await agentOn(ai.binding)

    agent.send('hello')
    await agent.idle()

    expect(
      session
        .snapshot()
        .filter((entry) => entry.kind === 'chunk')
        .map((entry) => entry.text),
    ).toEqual(['Hello', ' there'])
    expect(session.messages()).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Hello there', toolCalls: [] },
    ])

    // The step went to the default model, with the prompt, the messages and the
    // registered tools, and asked for a stream.
    const call = ai.calls[0]!
    expect(call.model).toBe(defaultWorkersAiModel)
    expect(call.inputs.stream).toBe(true)
    expect(call.inputs.messages[0]).toEqual({
      role: 'system',
      content: 'Answer briefly.',
    })
    expect(call.inputs.messages.at(-1)).toEqual({
      role: 'user',
      content: 'hello',
    })
    expect(call.inputs.tools[0].function.name).toBe('search')

    await client.destroy()
  })

  it('reads an answer framed as chat-completions deltas as readily as the native one', async () => {
    const ai = fakeAi([{ frames: chatAnswer(['Same', ' answer']) }])
    const { client, agent, session } = await agentOn(ai.binding, {
      model: '@cf/openai/gpt-oss-120b',
      name: 'gpt-oss',
    })

    agent.send('hello')
    await agent.idle()

    expect(session.messages().at(-1)).toEqual({
      role: 'assistant',
      content: 'Same answer',
      toolCalls: [],
    })
    expect(ai.calls[0]!.model).toBe('@cf/openai/gpt-oss-120b')

    await client.destroy()
  })

  it('runs the tool the model called and sends its result back in the next step', async () => {
    const ai = fakeAi([
      {
        frames: nativeAnswer(
          ['Looking'],
          [{ name: 'search', arguments: { query: 'cats' } }],
        ),
      },
      { frames: nativeAnswer(['Found them.']) },
    ])
    const { client, agent, session } = await agentOn(ai.binding)

    agent.send('find cats')
    await agent.idle()

    expect(
      session
        .snapshot()
        .filter((entry) => entry.kind === 'tool-result')
        .map((entry) => entry.outcome),
    ).toEqual([{ ok: true, value: 'found cats' }])

    // The second step is the point of the round trip: the model reads the
    // answer to the call it made.
    expect(ai.calls).toHaveLength(2)
    expect(ai.calls[1]!.inputs.messages.slice(-2)).toEqual([
      {
        role: 'assistant',
        content: 'Looking',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'search', arguments: '{"query":"cats"}' },
          },
        ],
      },
      {
        role: 'tool',
        name: 'search',
        tool_call_id: 'call-1',
        content: 'found cats',
      },
    ])
    expect(session.messages().at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Found them.',
    })

    await client.destroy()
  })

  it('assembles a tool call whose name and arguments arrive in pieces', async () => {
    const ai = fakeAi([
      {
        frames: [
          frame({ choices: [{ delta: { content: 'Looking' } }] }),
          frame({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_abc',
                      function: { name: 'search', arguments: '' },
                    },
                  ],
                },
              },
            ],
          }),
          frame({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: '{"query":' } },
                  ],
                },
              },
            ],
          }),
          frame({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: '"cats"}' } },
                  ],
                },
              },
            ],
          }),
          frame('[DONE]'),
        ],
      },
      { frames: nativeAnswer(['Found them.']) },
    ])
    const { client, agent, session } = await agentOn(ai.binding)

    agent.send('find cats')
    await agent.idle()

    expect(
      session.snapshot().filter((entry) => entry.kind === 'tool-call'),
    ).toMatchObject([
      { call: { id: 'call_abc', name: 'search', args: { query: 'cats' } } },
    ])

    await client.destroy()
  })

  it('ends the step with an error entry when the stream fails part-way', async () => {
    const ai = fakeAi([
      {
        frames: [
          frame({ response: 'partial' }),
          frame({ error: { message: 'the upstream model is overloaded' } }),
        ],
      },
    ])
    const { client, agent, session } = await agentOn(ai.binding)

    agent.send('hello')
    await agent.idle()

    const entries = session.snapshot()
    expect(entries.filter((entry) => entry.kind === 'error')).toMatchObject([
      { scope: 'model', message: /the upstream model is overloaded/ },
    ])
    // What did arrive is kept: the turn closes with what the model managed (E1).
    expect(entries.at(-1)).toMatchObject({
      kind: 'turn-closed',
      reason: 'error',
    })
    expect(session.messages().at(-1)).toMatchObject({
      role: 'assistant',
      content: 'partial',
    })

    await client.destroy()
  })

  it('stops the stream when the turn is cancelled, and takes the next turn as usual', async () => {
    const ai = fakeAi([
      // The first answer never ends on its own; only a cancellation ends it.
      { frames: [frame({ response: 'thinking' })], hold: true },
      { frames: nativeAnswer(['Second answer.']) },
    ])
    const { client, agent, session } = await agentOn(ai.binding)

    agent.send('hello')
    await until(() => session.snapshot(), 'chunk')
    await agent.cancel()

    expect(ai.cancelled()).toBe(1)
    expect(session.snapshot().at(-1)).toMatchObject({
      kind: 'turn-closed',
      reason: 'cancelled',
    })

    // The agent is not spent: the next turn runs against the same provider.
    agent.send('again')
    await agent.idle()
    expect(session.messages().at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Second answer.',
    })

    await client.destroy()
  })

  it('registers into the model registry and unregisters with its plugin', async () => {
    const ai = fakeAi([])
    const client = createClient({
      plugins: [
        { id: 'models', plugin: modelsPlugin },
        {
          id: 'model',
          plugin: workersAiModelPlugin,
          options: { binding: ai.binding, name: 'workers-ai' } as never,
        },
      ],
    })
    await client.settled()

    const registry = client.getContext(modelKey)!
    expect(registry.list().map((each) => each.name)).toEqual(['workers-ai'])

    // The key stays; only the provider goes (E2).
    await client.removePlugin('model')
    expect(client.getContext(modelKey)).toBe(registry)
    expect(registry.current()).toBeUndefined()

    await client.destroy()
  })

  it('ends in error when its options name no binding that can run', async () => {
    const client = createClient({
      plugins: [
        { id: 'models', plugin: modelsPlugin },
        {
          id: 'model',
          plugin: workersAiModelPlugin,
          options: { binding: { run: 'not a function' } } as never,
        },
      ],
    })
    await client.settled()

    const instance = client.inspect().find((each) => each.id === 'model')!
    expect(instance.status).toBe('error')
    expect(String((instance.error as Error).message)).toMatch(
      /Workers AI binding is required/,
    )
    expect(client.getContext(modelKey)!.list()).toEqual([])

    await client.destroy()
  })
})
