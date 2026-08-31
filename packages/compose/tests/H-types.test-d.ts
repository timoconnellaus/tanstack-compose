import { describe, expectTypeOf, it } from 'vitest'
import {
  createAction,
  createClient,
  createContextKey,
  createEvent,
  definePlugin,
} from '../src/index'
import { mailSentEvent, mailerKey, mailerPlugin } from './helpers/other-package'
import { intervalValidator } from './helpers/validator'
import type { Mailer } from './helpers/other-package'

const clockKey = createContextKey<{ now: () => number }>('clock')
const secretKey = createContextKey<string>('secret')

describe('H. Types', () => {
  it('H1 reading context is typed from the declared deps', () => {
    definePlugin({
      name: 'typed-reader',
      deps: [clockKey, mailerKey],
      setup(instance) {
        expectTypeOf(instance.context.get(clockKey)).toEqualTypeOf<{
          now: () => number
        }>()
        expectTypeOf(instance.context.get(mailerKey)).toEqualTypeOf<Mailer>()

        // @ts-expect-error — `secret` was not declared as a dep.
        instance.context.get(secretKey)

        // Reading an undeclared key is still possible through `peek`, which
        // admits that the value may be absent.
        expectTypeOf(instance.context.peek(secretKey)).toEqualTypeOf<
          string | undefined
        >()
      },
    })
  })

  it('H2 payloads, action input and result, and options are inferred from the builders', () => {
    const started = createEvent<{ at: number }>('started')
    const awaited = createEvent<{ at: number }>('awaited', { awaited: true })
    const compute = createAction<{ left: number; right: number }, string>(
      'compute',
    )

    definePlugin({
      name: 'inferred',
      validator: intervalValidator,
      setup(instance, options) {
        expectTypeOf(options).toEqualTypeOf<{ every: number }>()

        instance.on(started, (payload) => {
          expectTypeOf(payload).toEqualTypeOf<{ at: number }>()
        })
        expectTypeOf(instance.emit(started, { at: 1 })).toEqualTypeOf<void>()
        expectTypeOf(instance.emit(awaited, { at: 1 })).toEqualTypeOf<
          Promise<void>
        >()

        instance.defineAction(compute, (input) => {
          expectTypeOf(input).toEqualTypeOf<{ left: number; right: number }>()
          return `${input.left + input.right}`
        })
        instance.use(compute, ({ input, next }) => {
          expectTypeOf(input).toEqualTypeOf<{ left: number; right: number }>()
          expectTypeOf(next).toEqualTypeOf<
            (input: { left: number; right: number }) => Promise<string>
          >()
          return next(input)
        })
        expectTypeOf(
          instance.dispatch(compute, { left: 1, right: 2 }),
        ).toEqualTypeOf<Promise<string>>()
      },
    })

    const client = createClient()
    expectTypeOf(client.emit(started, { at: 1 })).toEqualTypeOf<void>()
    expectTypeOf(client.emit(awaited, { at: 1 })).toEqualTypeOf<Promise<void>>()
  })

  it('H3 a plugin authored in another package keeps full types with value imports only', () => {
    const client = createClient({
      plugins: [
        {
          id: 'mailer',
          plugin: mailerPlugin,
          options: { from: 'ada@example.test' },
        },
      ],
    })

    void client.addPlugin({
      id: 'wrong',
      plugin: mailerPlugin,
      // @ts-expect-error — the options are typed by the plugin's validator.
      options: { from: 1 },
    })

    expectTypeOf(client.getContext(mailerKey)).toEqualTypeOf<
      Mailer | undefined
    >()

    definePlugin({
      name: 'consumer',
      deps: [mailerKey],
      setup(instance) {
        expectTypeOf(instance.context.get(mailerKey).send).toEqualTypeOf<
          (to: string) => Promise<'sent'>
        >()
        instance.on(mailSentEvent, (payload) => {
          expectTypeOf(payload).toEqualTypeOf<{ to: string }>()
        })
      },
    })
  })
})
