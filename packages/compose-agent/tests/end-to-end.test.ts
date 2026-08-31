import { createPlugin } from '@tanstack/compose'
import { describe, expect, it } from 'vitest'
import {
  createTool,
  modelKey,
  promptSectionPlugin,
  requestAction,
  toolCallAction,
  toolMiddleware,
} from '../src/index'
import { buildAgent, kindsOf } from './helpers/agent'
import { anyValidator, validator } from './helpers/validator'
import type { ModelProvider, ToolOutcome } from '../src/index'

const wordValidator = validator<unknown, { word: string }>((value) => {
  const word = (value as { word?: unknown } | null)?.word
  if (typeof word !== 'string') {
    return { issues: [{ message: 'expected a string', path: ['word'] }] }
  }
  return { value: { word } }
})

/** A second provider, so the swap between turns is a real change of plugin. */
const closingModelPlugin = createPlugin({
  name: 'closing-model',
  provides: [modelKey],
  setup(instance) {
    const provider: ModelProvider = {
      name: 'closing',
      stream: () =>
        (async function* stream() {
          await Promise.resolve()
          yield {
            kind: 'text' as const,
            text: 'Goodbye from the second provider.',
          }
        })(),
    }
    instance.provide(modelKey, provider)
  },
})

describe('G. End to end', () => {
  it('runs a two-turn conversation with tools, middleware, a new prompt section and a swap', async () => {
    const ran: Array<string> = []
    const shout = createTool({
      name: 'shout',
      description: 'Shout a word',
      validator: wordValidator,
      execute: ({ word }) => {
        ran.push(`shout:${word}`)
        return word.toUpperCase()
      },
    })
    const audit = createTool({
      name: 'audit',
      description: 'Runs alone',
      validator: anyValidator,
      concurrency: 'exclusive',
      execute: () => {
        ran.push('audit')
        return 'audited'
      },
    })
    const secret = createTool({
      name: 'secret',
      description: 'Never allowed to run',
      validator: anyValidator,
      execute: () => {
        ran.push('secret')
        return 'leaked'
      },
    })

    /** A policy plugin: it refuses one call and rewrites another. */
    const policyPlugin = createPlugin({
      name: 'policy',
      setup(instance) {
        const refusal: ToolOutcome = { ok: false, error: 'refused by policy' }
        instance.use(toolCallAction, ({ input, next }) =>
          input.call.name === 'secret' ? refusal : next(input),
        )
        instance.use(
          toolCallAction,
          toolMiddleware(shout, ({ input, next }) =>
            next({ word: `${input.args.word} there` }),
          ),
        )
      },
    })

    const { client, agent, session } = await buildAgent({
      tools: [shout, audit, secret],
      sections: [{ name: 'base', text: 'Be helpful.' }],
      script: [
        {
          chunks: ['Working', '…'],
          toolCalls: [
            { name: 'shout', args: { word: 'hello' } },
            { name: 'audit', args: {} },
            { name: 'secret', args: {} },
          ],
        },
        { chunks: ['Turn one is done.'] },
      ],
    })
    await client.addPlugin({ id: 'policy', plugin: policyPlugin })

    const steps: Array<{ system: string; provider: string }> = []
    client.use(requestAction, ({ input, next }) => {
      steps.push({
        system: input.system,
        provider: client.getContext(modelKey)!.name,
      })
      return next(input)
    })

    agent.send('say hello')
    await agent.idle()

    // Between the turns: a new prompt section, and a different provider.
    await client.addPlugin({
      id: 'closing-note',
      plugin: promptSectionPlugin,
      options: { sections: [{ name: 'closing', text: 'Sign off warmly.' }] },
    })
    await client.setPluginList(
      client.pluginList.state.map((entry) =>
        entry.id === 'model'
          ? { id: 'model', plugin: closingModelPlugin }
          : entry,
      ),
    )

    agent.send('now say goodbye')
    await agent.idle()

    // The prompt and the provider each step saw.
    expect(steps).toEqual([
      { system: 'Be helpful.', provider: 'scripted' },
      { system: 'Be helpful.', provider: 'scripted' },
      { system: 'Be helpful.\n\nSign off warmly.', provider: 'closing' },
    ])

    // Only the calls the policy allowed ran, and the rewrite reached the tool.
    expect(ran).toEqual(['shout:hello there', 'audit'])

    // The session log, both turns end to end.
    expect(kindsOf(session.snapshot())).toEqual([
      'turn-opened',
      'input',
      'step-opened',
      'chunk',
      'chunk',
      'assistant',
      'tool-call',
      'tool-result',
      'tool-call',
      'tool-result',
      'tool-call',
      'tool-result',
      'step-closed',
      'step-opened',
      'chunk',
      'assistant',
      'step-closed',
      'turn-closed',
      'turn-opened',
      'input',
      'step-opened',
      'chunk',
      'assistant',
      'step-closed',
      'turn-closed',
    ])

    // Results are in the order the model issued the calls, whatever ran when.
    expect(
      session
        .snapshot()
        .filter((entry) => entry.kind === 'tool-result')
        .map((entry) => [entry.name, entry.outcome]),
    ).toEqual([
      ['shout', { ok: true, value: 'HELLO THERE' }],
      ['audit', { ok: true, value: 'audited' }],
      ['secret', { ok: false, error: 'refused by policy' }],
    ])

    // The messages derived from that log.
    expect(session.messages()).toEqual([
      { role: 'user', content: 'say hello' },
      {
        role: 'assistant',
        content: 'Working…',
        toolCalls: [
          { id: 'call-1', name: 'shout', args: { word: 'hello' } },
          { id: 'call-2', name: 'audit', args: {} },
          { id: 'call-3', name: 'secret', args: {} },
        ],
      },
      {
        role: 'tool',
        callId: 'call-1',
        name: 'shout',
        content: 'HELLO THERE',
        isError: false,
      },
      {
        role: 'tool',
        callId: 'call-2',
        name: 'audit',
        content: 'audited',
        isError: false,
      },
      {
        role: 'tool',
        callId: 'call-3',
        name: 'secret',
        content: 'refused by policy',
        isError: true,
      },
      { role: 'assistant', content: 'Turn one is done.', toolCalls: [] },
      { role: 'user', content: 'now say goodbye' },
      {
        role: 'assistant',
        content: 'Goodbye from the second provider.',
        toolCalls: [],
      },
    ])

    // Nothing was swallowed on the way.
    expect(client.errors.state).toEqual([])

    // And the client holds no leaked resources afterwards.
    const ids = client.inspect().map((entry) => entry.id)
    await client.destroy()
    expect(client.inspect()).toEqual([])
    expect(client.context.state).toEqual([])
    for (const id of ids) expect(client.resources(id)).toBeUndefined()
  })
})
