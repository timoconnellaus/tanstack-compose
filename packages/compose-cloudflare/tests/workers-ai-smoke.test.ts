import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createWorkersAiModel } from '../src'
import type { WorkersAiBinding } from '../src'

const bindings = env as unknown as {
  COMPOSE_WORKERS_AI_SMOKE?: string
  COMPOSE_WORKERS_AI_MODEL?: string
  AI?: WorkersAiBinding
}
const asked = bindings.COMPOSE_WORKERS_AI_SMOKE === '1'

describe.skipIf(!asked)('a real Workers AI binding', () => {
  it('streams an answer', async () => {
    const model = createWorkersAiModel({
      binding: bindings.AI!,
      model: bindings.COMPOSE_WORKERS_AI_MODEL,
      options: { max_tokens: 64 },
    })
    let answer = ''
    for await (const chunk of model.stream(
      {
        turn: 1,
        step: 1,
        system: '',
        messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
        tools: [],
        options: {},
      },
      new AbortController().signal,
    )) {
      if (chunk.kind === 'text') answer += chunk.text
    }
    expect(answer.toLowerCase()).toContain('pong')
  }, 60_000)
})
