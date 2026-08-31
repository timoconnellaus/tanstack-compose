import { env } from 'cloudflare:test'
import { createClient } from '@tanstack/compose'
import {
  agentKey,
  loopPlugin,
  modelsPlugin,
  promptPlugin,
  sessionKey,
  sessionPlugin,
  toolsPlugin,
} from '@tanstack/compose-agent'
import { describe, expect, it } from 'vitest'
import { workersAiModelPlugin } from '../src/index'
import type { WorkersAiBinding } from '../src/index'

/**
 * The one test that runs a real model. There is no local simulation of Workers
 * AI — inference always runs on Cloudflare — so it needs a logged-in account
 * and spends that account's allocation, and it skips itself unless it is asked
 * for by name:
 *
 * ```sh
 * pnpm wrangler login
 * COMPOSE_WORKERS_AI_SMOKE=1 pnpm --filter @tanstack/compose-cloudflare test:lib
 * ```
 *
 * The variable also switches the suite to the `smoke` environment of
 * `wrangler.jsonc`, whose AI binding is the real one. Point it at another model
 * with `COMPOSE_WORKERS_AI_MODEL`.
 */
const bindings = env as unknown as {
  COMPOSE_WORKERS_AI_SMOKE?: string
  COMPOSE_WORKERS_AI_MODEL?: string
  AI?: WorkersAiBinding
}
const asked = bindings.COMPOSE_WORKERS_AI_SMOKE === '1'

describe.skipIf(!asked)('a real Workers AI binding', () => {
  it('answers one turn of a conversation', async () => {
    const client = createClient({
      plugins: [
        { id: 'session', plugin: sessionPlugin },
        { id: 'tools', plugin: toolsPlugin },
        { id: 'prompt', plugin: promptPlugin },
        { id: 'models', plugin: modelsPlugin },
        {
          id: 'model',
          plugin: workersAiModelPlugin,
          options: {
            binding: bindings.AI!,
            model: bindings.COMPOSE_WORKERS_AI_MODEL,
            options: { max_tokens: 64 },
          } as never,
        },
        { id: 'loop', plugin: loopPlugin },
      ],
    })
    await client.settled()

    const agent = client.getContext(agentKey)!
    const session = client.getContext(sessionKey)!
    agent.send('Reply with exactly the word: pong')
    await agent.idle()

    expect(
      session.snapshot().filter((entry) => entry.kind === 'error'),
    ).toEqual([])
    const answer = session.messages().at(-1)
    expect(answer).toMatchObject({ role: 'assistant' })
    expect((answer as { content: string }).content.toLowerCase()).toContain(
      'pong',
    )

    await client.destroy()
  }, 60_000)
})
