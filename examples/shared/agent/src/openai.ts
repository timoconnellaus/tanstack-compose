/**
 * An example-local **model provider** that speaks the
 * OpenAI-compatible chat-completions streaming protocol over the global
 * `fetch`, with no vendor SDK. Point `baseUrl` at OpenAI, DeepSeek or a local
 * server; nothing else in an agent changes, because the plugin only registers
 * itself into the agent layer's model registry.
 *
 * It holds no secret: it names a **credential** and reads the value through the
 * `credentials` context key when it starts (E5).
 *
 * Terms are the ones in `CONTEXT.md`; the contract it meets is E4 of
 * `docs/acceptance/agent.md`.
 */

import { createPlugin } from '@tanstack/compose'
import { credentialsKey } from './credentials'
import { modelKey } from './keys'
import type { StandardSchemaV1 } from '@tanstack/compose'
import type {
  Message,
  ModelChunk,
  ModelProvider,
  ModelRequest,
  ToolCall,
} from './types'

/** What the provider needs to reach an endpoint. */
export interface OpenAiOptions {
  /** The model name the endpoint knows, e.g. `gpt-4o-mini` or `deepseek-chat`. */
  model: string
  /** The API root. Defaults to `https://api.openai.com/v1`. */
  baseUrl?: string
  /**
   * The **credential** to send: the _name_ of one, never a value. Defaults to
   * `OPENAI_API_KEY`, and the value is read through the `credentials` key when
   * the plugin starts. `null` means send no `authorization` header at all,
   * which is what an OpenAI-compatible server running locally without auth
   * wants; it has to be said, so a missing credential is never mistaken for it.
   */
  credential?: string | null
  /** Extra request headers, merged over the ones the provider sets. */
  headers?: Record<string, string>
  /** The provider's name, as it appears in inspection. Defaults to the model. */
  name?: string
}

interface ResolvedOptions {
  model: string
  baseUrl: string
  credential: string | null
  headers: Record<string, string>
  name: string
}

/** The endpoint one request goes to, with the credential value it carries. */
interface Endpoint extends ResolvedOptions {
  apiKey: string | undefined
}

const openaiOptions: StandardSchemaV1<OpenAiOptions, ResolvedOptions> = {
  '~standard': {
    version: 1,
    vendor: 'compose-example-agent-openai',
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
          credential:
            options.credential === null
              ? null
              : (options.credential ?? 'OPENAI_API_KEY'),
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
  options: Endpoint,
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
  options: Endpoint,
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
      `agent example: the endpoint answered ${response.status}${detail === '' ? '' : ` — ${detail}`}`,
    )
  }
  if (!response.body) {
    throw new Error('agent example: the endpoint answered without a body')
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
        `agent example: ${event.error.message ?? 'the stream reported an error'}`,
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
 * A **model provider** for any OpenAI-compatible chat-completions endpoint. It
 * registers into the agent layer's model registry and unregisters through its
 * cleanup, so adding it, removing it or selecting another provider takes effect
 * at the next turn with nothing else restarting (E2, E4). It names a
 * **credential** and reads the value through `credentialsKey` when it starts; a
 * credential with no value leaves the entry in `error` naming the credential and
 * never a value (E5).
 *
 * @example
 * ```ts
 * await client.addPlugin({
 *   id: 'model',
 *   plugin: openaiModelPlugin,
 *   options: { model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', credential: 'DEEPSEEK_API_KEY' },
 * })
 * ```
 */
export const openaiModelPlugin = createPlugin({
  name: 'openai-model',
  deps: [modelKey, credentialsKey],
  validator: openaiOptions,
  setup(instance, options) {
    // The credential is read once, by name, and held in this closure. It is
    // never in the entry's options, so it is in no store and no tool result.
    const apiKey =
      options.credential === null
        ? undefined
        : instance.context.get(credentialsKey).get(options.credential)
    if (options.credential !== null && apiKey === undefined) {
      throw new Error(
        `agent example: the credential "${options.credential}" has no value; provide it through the credentials plugin, name another one, or set credential: null for an endpoint that needs none`,
      )
    }

    const endpoint: Endpoint = { ...options, apiKey }
    const provider: ModelProvider = {
      name: options.name,
      stream: (request: ModelRequest, signal: AbortSignal) =>
        streamCompletion(endpoint, request, signal),
    }
    instance.cleanup(
      instance.context.get(modelKey).register(provider),
      `provider(${options.name})`,
    )
  },
})
