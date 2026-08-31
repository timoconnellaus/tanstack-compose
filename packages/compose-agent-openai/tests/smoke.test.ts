import { createClient } from '@tanstack/compose'
import {
  agentKey,
  loopPlugin,
  sessionKey,
  sessionPlugin,
} from '@tanstack/compose-agent'
import { describe, expect, it } from 'vitest'
import { openaiModelPlugin } from '../src/index'

/**
 * The one test that talks to a real endpoint. It skips itself when there is no
 * key, so it never fails in CI and can be run locally by exporting one.
 *
 * `COMPOSE_AGENT_MODEL_KEY_VAR` names which variable holds the key, and
 * `COMPOSE_AGENT_MODEL` / `COMPOSE_AGENT_BASE_URL` point it at another
 * OpenAI-compatible endpoint, e.g. DeepSeek or a local server.
 */
const keyVar = process.env.COMPOSE_AGENT_MODEL_KEY_VAR ?? 'OPENAI_API_KEY'
const hasKey = (process.env[keyVar] ?? '') !== ''

describe.skipIf(!hasKey)('A real OpenAI-compatible endpoint', () => {
  it('answers one turn of a conversation', async () => {
    const client = createClient({
      plugins: [
        { id: 'session', plugin: sessionPlugin },
        {
          id: 'model',
          plugin: openaiModelPlugin,
          options: {
            model: process.env.COMPOSE_AGENT_MODEL ?? 'gpt-4o-mini',
            baseUrl: process.env.COMPOSE_AGENT_BASE_URL,
            apiKeyEnvVar: keyVar,
          },
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
