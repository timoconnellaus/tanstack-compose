import { createClient, createPlugin } from '@tanstack/compose'
import { describe, expectTypeOf, it } from 'vitest'
import {
  createTool,
  promptKey,
  requestAction,
  sessionAppendedEvent,
  sessionKey,
  toolCallAction,
  toolMiddleware,
  toolsKey,
} from '../src/index'
import { lookupPlugin } from './helpers/other-package'
import { queryValidator } from './helpers/validator'
import type { lookupTool } from './helpers/other-package'
import type {
  ArgsOf,
  Message,
  ModelRequest,
  PromptRegistry,
  ResultOfTool,
  SessionLog,
  ToolCall,
  ToolDefinition,
  ToolOutcome,
  ToolRegistry,
} from '../src/index'

describe('F. Types', () => {
  it("a tool's arguments and result are typed from its definition", () => {
    const search = createTool({
      name: 'search',
      description: 'Search the index',
      validator: queryValidator,
      execute: ({ query }) => {
        expectTypeOf(query).toEqualTypeOf<string>()
        return { found: query.length }
      },
    })

    expectTypeOf(search).toEqualTypeOf<
      ToolDefinition<{ query: string }, { found: number }>
    >()
    expectTypeOf<ArgsOf<typeof search>>().toEqualTypeOf<{ query: string }>()
    expectTypeOf<ResultOfTool<typeof search>>().toEqualTypeOf<{
      found: number
    }>()

    // An async tool's result is what it resolves to, not the promise.
    const slow = createTool({
      name: 'slow',
      description: 'Search slowly',
      validator: queryValidator,
      execute: async ({ query }) => Promise.resolve(query.length),
    })
    expectTypeOf<ResultOfTool<typeof slow>>().toEqualTypeOf<number>()

    // Middleware sees both types without a cast.
    toolMiddleware(search, async ({ input, next }) => {
      expectTypeOf(input.args).toEqualTypeOf<{ query: string }>()
      expectTypeOf(input.call).toEqualTypeOf<ToolCall>()
      const outcome = await next({ query: input.args.query.trim() })
      expectTypeOf(outcome).toEqualTypeOf<ToolOutcome<{ found: number }>>()
      if (outcome.ok)
        expectTypeOf(outcome.value).toEqualTypeOf<{
          found: number
        }>()

      // @ts-expect-error — the tool takes `{ query: string }`, not a number.
      await next({ query: 1 })
      return { ok: false, error: 'refused' }
    })
  })

  it('session entries narrow on their kind', () => {
    const client = createClient()
    client.on(sessionAppendedEvent, (entry) => {
      if (entry.kind === 'assistant') {
        expectTypeOf(entry.text).toEqualTypeOf<string>()
        expectTypeOf(entry.toolCalls).toEqualTypeOf<Array<ToolCall>>()
      }
      if (entry.kind === 'tool-result') {
        expectTypeOf(entry.outcome).toEqualTypeOf<ToolOutcome>()
      }
      if (entry.kind === 'turn-closed') {
        expectTypeOf(entry.reason).toEqualTypeOf<
          'complete' | 'cancelled' | 'error'
        >()
        // @ts-expect-error — only an `input` entry carries text.
        entry.text
      }
      // Every entry, whatever its kind, has an id and a turn.
      expectTypeOf(entry.id).toEqualTypeOf<string>()
      expectTypeOf(entry.turn).toEqualTypeOf<number>()
    })

    client.use(requestAction, ({ input, next }) => {
      expectTypeOf(input).toEqualTypeOf<ModelRequest>()
      expectTypeOf(input.messages).toEqualTypeOf<Array<Message>>()
      return next(input)
    })
    client.use(toolCallAction, ({ input, next }) => {
      expectTypeOf(input.call.args).toEqualTypeOf<unknown>()
      return next(input)
    })
  })

  it('a plugin authored in another package keeps full types with value imports only', () => {
    expectTypeOf<ArgsOf<typeof lookupTool>>().toEqualTypeOf<{ query: string }>()
    expectTypeOf<ResultOfTool<typeof lookupTool>>().toEqualTypeOf<{
      found: number
    }>()
    void lookupPlugin

    createPlugin({
      name: 'follower',
      deps: [sessionKey, toolsKey],
      setup(instance) {
        expectTypeOf(
          instance.context.get(sessionKey),
        ).toEqualTypeOf<SessionLog>()
        expectTypeOf(
          instance.context.get(toolsKey),
        ).toEqualTypeOf<ToolRegistry>()

        // @ts-expect-error — `promptKey` was not declared as a dep.
        instance.context.get(promptKey)

        // Anything undeclared is still readable, and admits it may be absent.
        expectTypeOf(instance.context.peek(promptKey)).toEqualTypeOf<
          PromptRegistry | undefined
        >()
      },
    })
  })
})
