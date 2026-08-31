import { createClient } from '@tanstack/compose'
import {
  agentKey,
  createTool,
  loopPlugin,
  modelsPlugin,
  promptPlugin,
  sessionKey,
  sessionPlugin,
  toolsPlugin,
} from '@tanstack/compose-agent'
import { openaiModelPlugin } from '@tanstack/compose-agent-openai'
import { afterEach, describe, expect, it } from 'vitest'
import { handleChatCompletions } from '../src/index'
import { fakeAi, frame, nativeAnswer } from './helpers/ai'
import type { StandardSchemaV1 } from '@tanstack/compose'
import type { ChatCompletionsOptions, WorkersAiBinding } from '../src/index'

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

/**
 * Serve the route. The browser has no binding and no origin of its own to talk
 * to, so its provider's `fetch` is answered here by the same handler the dev
 * Worker mounts — the real provider, over the real route, against a fake
 * binding.
 */
const serve = (binding: WorkersAiBinding, options?: ChatCompletionsOptions) => {
  const original = globalThis.fetch
  const requests: Array<{ url: string }> = []
  globalThis.fetch = ((input: string, init: RequestInit) => {
    requests.push({ url: String(input) })
    return handleChatCompletions(
      new Request(String(input), init),
      binding,
      options,
    )
  }) as unknown as typeof fetch
  return {
    requests,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

/** A browser-shaped agent: the OpenAI-compatible provider, and no credential. */
const browserAgent = async () => {
  const client = createClient({
    plugins: [
      { id: 'session', plugin: sessionPlugin },
      { id: 'tools', plugin: toolsPlugin, options: { tools: [search] } },
      { id: 'prompt', plugin: promptPlugin },
      { id: 'models', plugin: modelsPlugin },
      {
        id: 'model',
        plugin: openaiModelPlugin,
        options: { model: 'workers-ai', baseUrl: 'https://page.example/ai' },
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

let route: ReturnType<typeof serve> | undefined
afterEach(() => {
  route?.restore()
  route = undefined
})

describe('a chat-completions route over a Workers AI binding', () => {
  it('answers a browser agent whose provider holds no credential', async () => {
    const ai = fakeAi([{ frames: nativeAnswer(['Hello', ' there']) }])
    route = serve(ai.binding)
    const { client, agent, session } = await browserAgent()

    agent.send('hello')
    await agent.idle()

    expect(route.requests[0]!.url).toBe(
      'https://page.example/ai/chat/completions',
    )
    expect(session.messages()).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Hello there', toolCalls: [] },
    ])
    // What the page asked for reached the binding, model name and all.
    expect(ai.calls[0]!.model).toBe('workers-ai')
    expect(ai.calls[0]!.inputs.tools[0].function.name).toBe('search')

    await client.destroy()
  })

  it('carries a tool call and its result through a whole turn', async () => {
    const ai = fakeAi([
      {
        frames: nativeAnswer(
          ['Looking'],
          [{ name: 'search', arguments: { query: 'cats' } }],
        ),
      },
      { frames: nativeAnswer(['Found them.']) },
    ])
    route = serve(ai.binding)
    const { client, agent, session } = await browserAgent()

    agent.send('find cats')
    await agent.idle()

    expect(
      session
        .snapshot()
        .filter((entry) => entry.kind === 'tool-result')
        .map((entry) => entry.outcome),
    ).toEqual([{ ok: true, value: 'found cats' }])
    expect(ai.calls[1]!.inputs.messages.at(-1)).toMatchObject({
      role: 'tool',
      content: 'found cats',
    })

    await client.destroy()
  })

  it('reports a mid-stream failure as a frame, so the step ends with an error', async () => {
    const ai = fakeAi([
      {
        frames: [
          frame({ response: 'partial' }),
          frame({ error: 'the upstream model is overloaded' }),
        ],
      },
    ])
    route = serve(ai.binding)
    const { client, agent, session } = await browserAgent()

    agent.send('hello')
    await agent.idle()

    expect(
      session.snapshot().filter((entry) => entry.kind === 'error'),
    ).toMatchObject([
      { scope: 'model', message: /the upstream model is overloaded/ },
    ])

    await client.destroy()
  })

  it('hands itself to another origin only when it is asked to', async () => {
    const ai = fakeAi([
      { frames: nativeAnswer(['hi']) },
      { frames: nativeAnswer(['hi']) },
    ])
    const body = JSON.stringify({
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    })
    const post = () =>
      new Request('https://page.example/ai/chat/completions', {
        method: 'POST',
        body,
      })

    const closed = await handleChatCompletions(post(), ai.binding)
    expect(closed.headers.get('access-control-allow-origin')).toBeNull()

    const open = await handleChatCompletions(post(), ai.binding, { cors: true })
    expect(open.headers.get('access-control-allow-origin')).toBe('*')
    const preflight = await handleChatCompletions(
      new Request('https://page.example/ai/chat/completions', {
        method: 'OPTIONS',
      }),
      ai.binding,
      { cors: true },
    )
    expect(preflight.status).toBe(204)
  })

  it('refuses a request it cannot answer instead of spending the binding', async () => {
    const ai = fakeAi([])

    const empty = await handleChatCompletions(
      new Request('https://page.example/ai/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ messages: [] }),
      }),
      ai.binding,
    )
    expect(empty.status).toBe(400)

    const wrongMethod = await handleChatCompletions(
      new Request('https://page.example/ai/chat/completions'),
      ai.binding,
    )
    expect(wrongMethod.status).toBe(405)
    expect(ai.calls).toEqual([])
  })
})
