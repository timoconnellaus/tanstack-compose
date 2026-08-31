import { createClient, createPlugin } from '@tanstack/compose'
import { describe, expect, it } from 'vitest'
import {
  agentKey,
  createTool,
  loopPlugin,
  modelKey,
  promptKey,
  requestAction,
  sessionKey,
  sessionPlugin,
  toolsKey,
} from '../src/index'
import { buildAgent, deferred, kindsOf } from './helpers/agent'
import { anyValidator } from './helpers/validator'
import type { Cleanup } from '@tanstack/compose'
import type {
  AnyTool,
  ModelProvider,
  PromptRegistry,
  ToolRegistry,
} from '../src/index'

describe('C. The loop', () => {
  it('input while idle starts a turn and input during a turn is taken up at the next step', async () => {
    const started = deferred()
    const release = deferred()
    const wait = createTool({
      name: 'wait',
      description: 'Wait to be released',
      validator: anyValidator,
      execute: async () => {
        started.resolve()
        await release.promise
        return 'released'
      },
    })

    const { client, agent, session } = await buildAgent({
      tools: [wait],
      script: [
        { toolCalls: [{ name: 'wait', args: {} }] },
        { chunks: ['both taken up'] },
        { chunks: ['a second turn'] },
      ],
    })

    agent.send('one')
    await started.promise
    // Queued while the turn is running: it joins at the next step boundary.
    agent.send('two')
    release.resolve()
    await agent.idle()

    expect(kindsOf(session.snapshot())).toEqual([
      'turn-opened',
      'input',
      'step-opened',
      'assistant',
      'tool-call',
      'tool-result',
      'step-closed',
      'input',
      'step-opened',
      'chunk',
      'assistant',
      'step-closed',
      'turn-closed',
    ])
    const inputs = session
      .snapshot()
      .filter((entry) => entry.kind === 'input')
      .map((entry) => entry.text)
    expect(inputs).toEqual(['one', 'two'])

    // Input while idle opens a new turn.
    agent.send('three')
    await agent.idle()
    const turns = session
      .snapshot()
      .filter((entry) => entry.kind === 'turn-opened')
      .map((entry) => entry.turn)
    expect(turns).toEqual([1, 2])

    await client.destroy()
  })

  it('a step is a request and its tool calls, and the turn closes when nothing is owed', async () => {
    const echo = createTool({
      name: 'echo',
      description: 'Echo back',
      validator: anyValidator,
      execute: () => 'echoed',
    })

    const requests: Array<{ turn: number; step: number }> = []
    const { client, agent, session } = await buildAgent({
      tools: [echo],
      script: [
        { toolCalls: [{ name: 'echo', args: {} }] },
        { toolCalls: [{ name: 'echo', args: {} }] },
        { chunks: ['done'] },
      ],
    })
    client.use(requestAction, ({ input, next }) => {
      requests.push({ turn: input.turn, step: input.step })
      return next(input)
    })

    agent.send('go')
    await agent.idle()

    // Three steps: two that called tools, and one that did not, which closed it.
    expect(requests).toEqual([
      { turn: 1, step: 1 },
      { turn: 1, step: 2 },
      { turn: 1, step: 3 },
    ])
    expect(
      session.snapshot().filter((entry) => entry.kind === 'step-closed').length,
    ).toBe(3)
    expect(session.snapshot().at(-1)).toMatchObject({
      kind: 'turn-closed',
      reason: 'complete',
    })

    await client.destroy()
  })

  it('a turn that never stops calling tools is stopped by its step limit', async () => {
    const echo = createTool({
      name: 'echo',
      description: 'Echo',
      validator: anyValidator,
      execute: () => 'echoed',
    })

    const { client, agent, session } = await buildAgent({
      tools: [echo],
      maxSteps: 2,
      script: Array.from({ length: 5 }, () => ({
        toolCalls: [{ name: 'echo', args: {} }],
      })),
    })

    agent.send('go')
    await agent.idle()

    expect(
      session.snapshot().filter((entry) => entry.kind === 'step-opened').length,
    ).toBe(2)
    expect(session.snapshot().at(-2)).toMatchObject({
      kind: 'error',
      scope: 'loop',
      message: 'the turn reached its step limit of 2',
    })
    expect(session.snapshot().at(-1)).toMatchObject({
      kind: 'turn-closed',
      reason: 'error',
    })
    expect(agent.status.state).toBe('idle')

    await client.destroy()
  })

  it('the prompt is assembled per step from the sections registered at that moment', async () => {
    let prompt: PromptRegistry | undefined = undefined
    let remove: Cleanup | undefined

    const addSection = createTool({
      name: 'add-section',
      description: 'Add a prompt section',
      validator: anyValidator,
      execute: () => {
        remove = prompt!.register({ name: 'extra', text: 'Be terse.' })
        return 'added'
      },
    })

    const systems: Array<string> = []
    const { client, agent } = await buildAgent({
      tools: [addSection],
      sections: [{ name: 'base', text: 'You are helpful.' }],
      script: [
        { toolCalls: [{ name: 'add-section', args: {} }] },
        { chunks: ['ok'] },
        { chunks: ['ok again'] },
      ],
    })
    prompt = client.getContext(promptKey)
    client.use(requestAction, ({ input, next }) => {
      systems.push(input.system)
      return next(input)
    })

    agent.send('go')
    await agent.idle()
    expect(systems).toEqual([
      'You are helpful.',
      'You are helpful.\n\nBe terse.',
    ])

    // Removing the section takes it out of the very next request.
    remove!()
    agent.send('again')
    await agent.idle()
    expect(systems.at(-1)).toBe('You are helpful.')

    await client.destroy()
  })

  it('the tools offered are the ones registered at that moment', async () => {
    let registry: ToolRegistry | undefined = undefined
    let remove: Cleanup | undefined

    const extra = createTool({
      name: 'extra',
      description: 'Registered mid-turn',
      validator: anyValidator,
      execute: () => 'extra ran',
    })
    const grow = createTool({
      name: 'grow',
      description: 'Register another tool',
      validator: anyValidator,
      execute: () => {
        remove = registry!.register(extra)
        return 'grown'
      },
    })

    const offered: Array<Array<string>> = []
    const { client, agent, session } = await buildAgent({
      tools: [grow],
      script: [
        { toolCalls: [{ name: 'grow', args: {} }] },
        { toolCalls: [{ name: 'extra', args: {} }] },
        { chunks: ['done'] },
        { toolCalls: [{ name: 'extra', args: {} }] },
        { chunks: ['gone'] },
      ],
    })
    registry = client.getContext(toolsKey)
    client.use(requestAction, ({ input, next }) => {
      offered.push(input.tools.map((tool) => tool.name))
      return next(input)
    })

    agent.send('go')
    await agent.idle()
    expect(offered).toEqual([['grow'], ['grow', 'extra'], ['grow', 'extra']])
    expect(
      session
        .snapshot()
        .find(
          (entry) => entry.kind === 'tool-result' && entry.name === 'extra',
        ),
    ).toMatchObject({ outcome: { ok: true, value: 'extra ran' } })

    // Removed: neither offered nor executable.
    remove!()
    agent.send('again')
    await agent.idle()
    expect(offered.at(-1)).toEqual(['grow'])
    expect(
      session
        .snapshot()
        .filter((entry) => entry.kind === 'tool-result')
        .at(-1),
    ).toMatchObject({ outcome: { ok: false, error: 'unknown tool "extra"' } })

    await client.destroy()
  })

  it('cancelling stops the request and the tool calls and leaves the agent idle and reusable', async () => {
    // The in-flight request: a provider that streams, then waits for the signal.
    const streaming = deferred()
    const slowModel = createPlugin({
      name: 'slow-model',
      provides: [modelKey],
      setup(instance) {
        const provider: ModelProvider = {
          name: 'slow',
          stream: (_request, signal) =>
            (async function* stream() {
              yield { kind: 'text' as const, text: 'Hel' }
              streaming.resolve()
              await new Promise<void>((resolve) =>
                signal.addEventListener('abort', () => resolve(), {
                  once: true,
                }),
              )
              yield { kind: 'text' as const, text: 'lo' }
            })(),
        }
        instance.provide(modelKey, provider)
      },
    })

    const client = createClient({
      plugins: [
        { id: 'session', plugin: sessionPlugin },
        { id: 'model', plugin: slowModel },
        { id: 'loop', plugin: loopPlugin },
      ],
    })
    await client.settled()
    const agent = client.getContext(agentKey)!

    agent.send('hello')
    await streaming.promise
    await agent.cancel()

    expect(agent.status.state).toBe('idle')
    const session = client.getContext(sessionKey)!
    // The partial assistant message still reached the log, and nothing after it.
    expect(kindsOf(session.snapshot())).toEqual([
      'turn-opened',
      'input',
      'step-opened',
      'chunk',
      'assistant',
      'step-closed',
      'turn-closed',
    ])
    expect(session.snapshot().at(-3)).toMatchObject({
      kind: 'assistant',
      text: 'Hel',
    })
    expect(session.snapshot().at(-1)).toMatchObject({
      kind: 'turn-closed',
      reason: 'cancelled',
    })
    await client.destroy()

    // And now the tool calls: a tool that ignores its signal cannot hold on.
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
    const second = await buildAgent({
      tools: [hang],
      script: [
        { chunks: ['calling'], toolCalls: [{ name: 'hang', args: {} }] },
        { chunks: ['and now a fresh turn'] },
      ],
    })

    second.agent.send('go')
    await running.promise
    await second.agent.cancel()

    expect(second.agent.status.state).toBe('idle')
    expect(kindsOf(second.session.snapshot())).toEqual([
      'turn-opened',
      'input',
      'step-opened',
      'chunk',
      'assistant',
      'tool-call',
      'step-closed',
      'turn-closed',
    ])
    expect(second.session.snapshot().at(-2)).toMatchObject({
      kind: 'step-closed',
      reason: 'cancelled',
    })
    expect(second.session.snapshot().at(-1)).toMatchObject({
      kind: 'turn-closed',
      reason: 'cancelled',
    })

    // Reusable: the next input opens a fresh turn that runs to completion.
    second.agent.send('again')
    await second.agent.idle()
    expect(second.session.snapshot().at(-1)).toMatchObject({
      kind: 'turn-closed',
      turn: 2,
      reason: 'complete',
    })

    await second.client.destroy()
  })

  it('removing the loop mid-turn cancels it and nothing writes to the session afterwards', async () => {
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

    const { client, agent, session } = await buildAgent({
      tools: [hang],
      script: [{ toolCalls: [{ name: 'hang', args: {} }] }],
    })

    agent.send('go')
    await running.promise
    await client.removePlugin('loop')

    expect(session.snapshot().at(-1)).toMatchObject({
      kind: 'turn-closed',
      reason: 'cancelled',
    })
    const afterRemoval = session.snapshot().length

    // The agent key is gone with the loop, and nothing appends any more.
    expect(client.getContext(agentKey)).toBeUndefined()
    agent.send('ignored')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(session.snapshot().length).toBe(afterRemoval)

    await client.destroy()
  })

  it('the agent status is a store and becoming idle can be awaited', async () => {
    const release = deferred()
    const started = deferred()
    const wait = createTool({
      name: 'wait',
      description: 'Wait to be released',
      validator: anyValidator,
      execute: async () => {
        started.resolve()
        await release.promise
        return 'released'
      },
    })

    const { client, agent } = await buildAgent({
      tools: [wait as AnyTool],
      script: [{ toolCalls: [{ name: 'wait', args: {} }] }, { chunks: ['ok'] }],
    })

    const seen: Array<string> = []
    const subscription = agent.status.subscribe(() => {
      seen.push(agent.status.state)
    })

    expect(agent.status.state).toBe('idle')
    // Already idle: awaiting resolves at once.
    await agent.idle()

    agent.send('go')
    expect(agent.status.state).toBe('running')
    await started.promise
    const idle = agent.idle()
    release.resolve()
    await idle
    expect(agent.status.state).toBe('idle')
    expect(seen).toEqual(['running', 'idle'])

    subscription.unsubscribe()
    await client.destroy()
  })
})
