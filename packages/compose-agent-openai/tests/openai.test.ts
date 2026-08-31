import { createClient } from '@tanstack/compose'
import {
  agentKey,
  createTool,
  loopPlugin,
  modelKey,
  modelsPlugin,
  promptPlugin,
  sessionKey,
  sessionPlugin,
  toolsPlugin,
} from '@tanstack/compose-agent'
import { afterEach, describe, expect, it } from 'vitest'
import { openaiModelPlugin } from '../src/index'
import { fixture, mockEndpoint } from './helpers/endpoint'
import type { StandardSchemaV1 } from '@tanstack/compose'
import type { ModelChunk, ModelRequest } from '@tanstack/compose-agent'

const anyArgs: StandardSchemaV1<unknown, Record<string, unknown>> = {
  '~standard': {
    version: 1,
    vendor: 'compose-agent-openai-tests',
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

const request = (overrides?: Partial<ModelRequest>): ModelRequest => ({
  turn: 1,
  step: 1,
  system: 'Be helpful.',
  messages: [{ role: 'user', content: 'hello' }],
  tools: [],
  options: {},
  ...overrides,
})

/**
 * Start a client with the model registry and the provider, and hand back the
 * provider the registry now holds.
 */
const provider = async (options: Record<string, unknown>) => {
  const client = createClient({
    plugins: [
      { id: 'models', plugin: modelsPlugin },
      { id: 'model', plugin: openaiModelPlugin, options: options as never },
    ],
  })
  await client.settled()
  return { client, model: client.getContext(modelKey)!.current()! }
}

const collect = async (
  stream: AsyncIterable<ModelChunk>,
): Promise<Array<ModelChunk>> => {
  const chunks: Array<ModelChunk> = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

let endpoint: ReturnType<typeof mockEndpoint> | undefined
afterEach(() => {
  endpoint?.restore()
  endpoint = undefined
})

describe('An OpenAI-compatible model provider', () => {
  it('streams the text of a recorded response as it arrives', async () => {
    endpoint = mockEndpoint({ sse: fixture('text') })
    const { client, model } = await provider({
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
    })

    const chunks = await collect(
      model.stream(request(), new AbortController().signal),
    )
    expect(chunks).toEqual([
      { kind: 'text', text: 'Hello' },
      { kind: 'text', text: ' there' },
    ])
    expect(model.name).toBe('gpt-4o-mini')

    const call = endpoint.calls[0]!
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(call.headers.authorization).toBe('Bearer sk-test')
    expect(call.body).toMatchObject({ model: 'gpt-4o-mini', stream: true })

    await client.destroy()
  })

  it('assembles a tool call whose name and arguments arrive in pieces', async () => {
    endpoint = mockEndpoint({ sse: fixture('tool-call'), sliceAt: 7 })
    const { client, model } = await provider({ model: 'gpt-4o-mini' })

    const chunks = await collect(
      model.stream(request(), new AbortController().signal),
    )
    expect(chunks).toEqual([
      { kind: 'text', text: 'Looking' },
      {
        kind: 'tool-call',
        call: { id: 'call_abc', name: 'search', args: { query: 'cats' } },
      },
    ])

    await client.destroy()
  })

  it('sends the system prompt, the messages and the tools in the wire shape', async () => {
    endpoint = mockEndpoint({ sse: fixture('text') })
    const { client, model } = await provider({
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1/',
      apiKey: 'sk-deepseek',
      headers: { 'x-trace': 'abc' },
      name: 'deepseek',
    })

    await collect(
      model.stream(
        request({
          messages: [
            { role: 'user', content: 'find cats' },
            {
              role: 'assistant',
              content: 'Looking',
              toolCalls: [
                { id: 'call_abc', name: 'search', args: { query: 'cats' } },
              ],
            },
            {
              role: 'tool',
              callId: 'call_abc',
              name: 'search',
              content: 'found cats',
              isError: false,
            },
          ],
          tools: [
            {
              name: 'search',
              description: 'Search the index',
              parameters: search.parameters,
            },
          ],
          options: { temperature: 0.2 },
        }),
        new AbortController().signal,
      ),
    )

    const call = endpoint.calls[0]!
    // A trailing slash on the base url does not double up.
    expect(call.url).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(call.headers['x-trace']).toBe('abc')
    expect(call.body).toEqual({
      model: 'deepseek-chat',
      stream: true,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'find cats' },
        {
          role: 'assistant',
          content: 'Looking',
          tool_calls: [
            {
              id: 'call_abc',
              type: 'function',
              function: { name: 'search', arguments: '{"query":"cats"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_abc', content: 'found cats' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'search',
            description: 'Search the index',
            parameters: search.parameters,
          },
        },
      ],
    })
    expect(model.name).toBe('deepseek')

    await client.destroy()
  })

  it('reads its key from a configurable environment variable and sends none when there is none', async () => {
    process.env.TEST_MODEL_KEY = 'sk-from-env'
    endpoint = mockEndpoint({ sse: fixture('text') })

    const fromEnv = await provider({
      model: 'gpt-4o-mini',
      apiKeyEnvVar: 'TEST_MODEL_KEY',
    })
    await collect(fromEnv.model.stream(request(), new AbortController().signal))
    expect(endpoint.calls[0]!.headers.authorization).toBe('Bearer sk-from-env')
    await fromEnv.client.destroy()
    delete process.env.TEST_MODEL_KEY

    // A local server needs no key at all, and gets no header.
    const local = await provider({
      model: 'llama',
      baseUrl: 'http://localhost:11434/v1',
      apiKeyEnvVar: 'TEST_MODEL_KEY',
    })
    await collect(local.model.stream(request(), new AbortController().signal))
    expect(endpoint.calls[1]!.url).toBe(
      'http://localhost:11434/v1/chat/completions',
    )
    expect(endpoint.calls[1]!.headers.authorization).toBeUndefined()
    await local.client.destroy()
  })

  it('reports a rejected request and a mid-stream error as failures', async () => {
    endpoint = mockEndpoint({ status: 401, body: 'invalid api key' })
    const rejected = await provider({ model: 'gpt-4o-mini' })
    await expect(
      collect(rejected.model.stream(request(), new AbortController().signal)),
    ).rejects.toThrow(/answered 401 — invalid api key/)
    await rejected.client.destroy()
    endpoint.restore()

    endpoint = mockEndpoint({ sse: fixture('mid-stream-error') })
    const broken = await provider({ model: 'gpt-4o-mini' })
    await expect(
      collect(broken.model.stream(request(), new AbortController().signal)),
    ).rejects.toThrow(/the upstream model is overloaded/)
    await broken.client.destroy()
  })

  it('passes the turn signal to the endpoint so a cancelled turn stops the request', async () => {
    endpoint = mockEndpoint({ sse: fixture('text') })
    const { client, model } = await provider({ model: 'gpt-4o-mini' })
    const controller = new AbortController()

    await collect(model.stream(request(), controller.signal))
    const sent = endpoint.calls[0]!.signal!
    expect(sent.aborted).toBe(false)
    controller.abort()
    expect(sent.aborted).toBe(true)

    await client.destroy()
  })

  it('registers into the model registry and unregisters with its plugin', async () => {
    endpoint = mockEndpoint({ sse: fixture('text') })
    const client = createClient({
      plugins: [
        { id: 'models', plugin: modelsPlugin },
        {
          id: 'model',
          plugin: openaiModelPlugin,
          options: { model: 'gpt-4o-mini', apiKey: 'sk-test' },
        },
      ],
    })
    await client.settled()

    const registry = client.getContext(modelKey)!
    expect(registry.list().map((each) => each.name)).toEqual(['gpt-4o-mini'])
    expect(registry.current()!.name).toBe('gpt-4o-mini')

    // The key stays; only the provider goes.
    await client.removePlugin('model')
    expect(client.getContext(modelKey)).toBe(registry)
    expect(registry.list()).toEqual([])
    expect(registry.current()).toBeUndefined()

    await client.destroy()
  })

  it('drives a whole turn of the agent loop, imported by value across packages', async () => {
    endpoint = mockEndpoint({ sse: fixture('text') })

    const client = createClient({
      plugins: [
        { id: 'session', plugin: sessionPlugin },
        { id: 'tools', plugin: toolsPlugin, options: { tools: [search] } },
        { id: 'prompt', plugin: promptPlugin },
        { id: 'models', plugin: modelsPlugin },
        {
          id: 'model',
          plugin: openaiModelPlugin,
          options: { model: 'gpt-4o-mini', apiKey: 'sk-test' },
        },
        { id: 'loop', plugin: loopPlugin },
      ],
    })
    await client.settled()

    const agent = client.getContext(agentKey)!
    const session = client.getContext(sessionKey)!
    agent.send('hello')
    await agent.idle()

    expect(session.messages()).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Hello there', toolCalls: [] },
    ])
    // The tools the registry holds reached the endpoint.
    expect(endpoint.calls[0]!.body.tools[0].function.name).toBe('search')

    await client.destroy()
  })
})
