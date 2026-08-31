/**
 * `@tanstack/compose-agent-openai` — a **model provider** that speaks the
 * OpenAI-compatible chat-completions streaming protocol over the global
 * `fetch`, with no vendor SDK. Point `baseUrl` at OpenAI, DeepSeek or a local
 * server; nothing else in an agent changes, because a provider is chosen
 * entirely by which plugin provides the `model` key.
 *
 * Terms are the ones in `CONTEXT.md`; the contract it meets is E4 of
 * `docs/acceptance/agent.md`.
 */

import { createPlugin } from '@tanstack/compose'
import { modelKey } from '@tanstack/compose-agent'
import type { StandardSchemaV1 } from '@tanstack/compose'
import type {
  Message,
  ModelChunk,
  ModelProvider,
  ModelRequest,
  ToolCall,
} from '@tanstack/compose-agent'

/** What the provider needs to reach an endpoint. */
export interface OpenAiOptions {
  /** The model name the endpoint knows, e.g. `gpt-4o-mini` or `deepseek-chat`. */
  model: string
  /** The API root. Defaults to `https://api.openai.com/v1`. */
  baseUrl?: string
  /** The key. When absent it is read from the environment; a local server needs none. */
  apiKey?: string
  /** Which environment variable holds the key. Defaults to `OPENAI_API_KEY`. */
  apiKeyEnvVar?: string
  /** Extra request headers, merged over the ones the provider sets. */
  headers?: Record<string, string>
  /** The provider's name, as it appears in inspection. Defaults to the model. */
  name?: string
}

interface ResolvedOptions {
  model: string
  baseUrl: string
  apiKey: string | undefined
  headers: Record<string, string>
  name: string
}

/** Read an environment variable without importing anything runtime-specific. */
const readEnv = (name: string): string | undefined =>
  (
    globalThis as {
      process?: { env?: Record<string, string | undefined> }
    }
  ).process?.env?.[name]

const openaiOptions: StandardSchemaV1<OpenAiOptions, ResolvedOptions> = {
  '~standard': {
    version: 1,
    vendor: 'compose-agent-openai',
    validate: (value: unknown) => {
      const options = value as OpenAiOptions | undefined
      if (!options?.model) {
        return {
          issues: [{ message: 'a model name is required', path: ['model'] }],
        }
      }
      return {
        value: {
          model: options.model,
          baseUrl: (options.baseUrl ?? 'https://api.openai.com/v1').replace(
            /\/$/,
            '',
          ),
          apiKey:
            options.apiKey ?? readEnv(options.apiKeyEnvVar ?? 'OPENAI_API_KEY'),
          headers: { ...options.headers },
          name: options.name ?? options.model,
        },
      }
    },
  },
}

/** Our messages in the wire shape the chat-completions protocol expects. */
const toWireMessages = (
  system: string,
  messages: ReadonlyArray<Message>,
): Array<Record<string, unknown>> => {
  const wire: Array<Record<string, unknown>> = []
  if (system !== '') wire.push({ role: 'system', content: system })
  for (const message of messages) {
    if (message.role === 'user') {
      wire.push({ role: 'user', content: message.content })
    } else if (message.role === 'assistant') {
      wire.push({
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.args ?? {}),
                },
              })),
            }
          : {}),
      })
    } else {
      wire.push({
        role: 'tool',
        tool_call_id: message.callId,
        content: message.content,
      })
    }
  }
  return wire
}

/** The request body for one step. */
const toWireBody = (
  options: ResolvedOptions,
  request: ModelRequest,
): Record<string, unknown> => ({
  model: options.model,
  stream: true,
  messages: toWireMessages(request.system, request.messages),
  ...(request.tools.length > 0
    ? {
        tools: request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
      }
    : {}),
  ...request.options,
})

interface PartialCall {
  id: string
  name: string
  arguments: string
}

/**
 * Split a server-sent-event body into its `data:` payloads. The protocol frames
 * events with a blank line, so a chunk that stops mid-event is held back until
 * the rest of it arrives.
 */
async function* sseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        for (const line of frame.split('\n')) {
          if (line.startsWith('data:')) yield line.slice(5).trim()
        }
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** Stream one chat completion, yielding text as it arrives and calls at the end. */
async function* streamCompletion(
  options: ResolvedOptions,
  request: ModelRequest,
  signal: AbortSignal,
): AsyncGenerator<ModelChunk> {
  const response = await fetch(`${options.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(options.apiKey === undefined
        ? {}
        : { authorization: `Bearer ${options.apiKey}` }),
      ...options.headers,
    },
    body: JSON.stringify(toWireBody(options, request)),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `@tanstack/compose-agent-openai: the endpoint answered ${response.status}${detail === '' ? '' : ` — ${detail}`}`,
    )
  }
  if (!response.body) {
    throw new Error(
      '@tanstack/compose-agent-openai: the endpoint answered without a body',
    )
  }

  const partials = new Map<number, PartialCall>()
  for await (const data of sseEvents(response.body)) {
    if (data === '' || data === '[DONE]') continue
    const event = JSON.parse(data) as {
      error?: { message?: string }
      choices?: Array<{
        delta?: {
          content?: string | null
          tool_calls?: Array<{
            index?: number
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
      }>
    }
    if (event.error) {
      throw new Error(
        `@tanstack/compose-agent-openai: ${event.error.message ?? 'the stream reported an error'}`,
      )
    }
    const delta = event.choices?.[0]?.delta
    if (!delta) continue
    if (typeof delta.content === 'string' && delta.content !== '') {
      yield { kind: 'text', text: delta.content }
    }
    for (const [at, call] of (delta.tool_calls ?? []).entries()) {
      const index = call.index ?? at
      const partial = partials.get(index) ?? { id: '', name: '', arguments: '' }
      partials.set(index, {
        id: call.id ?? partial.id,
        name: call.function?.name ?? partial.name,
        arguments: partial.arguments + (call.function?.arguments ?? ''),
      })
    }
  }

  for (const [index, partial] of [...partials.entries()].sort(
    (left, right) => left[0] - right[0],
  )) {
    const call: ToolCall = {
      id: partial.id === '' ? `call-${index + 1}` : partial.id,
      name: partial.name,
      args: partial.arguments === '' ? {} : JSON.parse(partial.arguments),
    }
    yield { kind: 'tool-call', call }
  }
}

/**
 * A **model provider** for any OpenAI-compatible chat-completions endpoint.
 * Provides the agent layer's `model` key, so swapping it for another provider —
 * or for the scripted one — is a single plugin-list edit (E2, E4).
 *
 * @example
 * ```ts
 * await client.addPlugin({
 *   id: 'model',
 *   plugin: openaiModelPlugin,
 *   options: { model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnvVar: 'DEEPSEEK_API_KEY' },
 * })
 * ```
 */
export const openaiModelPlugin = createPlugin({
  name: 'openai-model',
  provides: [modelKey],
  validator: openaiOptions,
  setup(instance, options) {
    const provider: ModelProvider = {
      name: options.name,
      stream: (request: ModelRequest, signal: AbortSignal) =>
        streamCompletion(options, request, signal),
    }
    instance.provide(modelKey, provider)
  },
})
