# `@tanstack/compose`

The framework-agnostic kernel of TanStack Compose: the **client**, **plugins**,
**context** and **deps**, **cleanup**, **status**, **options**, **middleware**
and **events**, and **plugin list** reconciliation.

An application is a plugin list. Editing that list while the application runs —
adding, removing, replacing or reconfiguring an entry — is how the application
changes shape, and the client makes sure nothing is left behind when it does.

## Installation

```sh
npm install @tanstack/compose
```

## A plugin that provides something

A **context key** carries the type of its value, so nothing has to be declared
globally. A plugin declares the keys it `provides` and the keys it needs as
`deps`, and every registration it makes is undone when its instance is removed.

```ts
import { createContextKey, createPlugin } from '@tanstack/compose'

export const loggerKey = createContextKey<{ log: (message: string) => void }>(
  'logger',
)

export const consoleLogger = createPlugin({
  name: 'console-logger',
  provides: [loggerKey],
  setup(instance) {
    instance.provide(loggerKey, { log: (message) => console.log(message) })
  },
})
```

## A plugin that depends on one

`instance.context.get` is typed from `deps`, so it can only read what the plugin
declared — and the value is always there, because an instance with an unmet dep
stays `pending` instead of starting.

```ts
const heartbeat = createPlugin({
  name: 'heartbeat',
  deps: [loggerKey],
  setup(instance) {
    const logger = instance.context.get(loggerKey)
    const handle = setInterval(() => logger.log('alive'), 1000)
    // Cleanups run in reverse order when the instance is removed.
    instance.cleanup(() => clearInterval(handle), 'heartbeat interval')

    // Any key can be read without declaring it; absent keys read as undefined.
    const maybe = instance.context.peek(someOtherKey)
  },
})
```

## Running a client

```ts
import { createClient } from '@tanstack/compose'

const client = createClient({
  plugins: [
    { id: 'logger', plugin: consoleLogger },
    { id: 'heartbeat', plugin: heartbeat },
  ],
})
await client.settled()
```

Editing the plugin list reconciles by `id`; only entries that changed are
started, stopped or restarted, and every edit resolves once the client is
quiescent.

```ts
await client.setEnabled('logger', false) // heartbeat is cleaned up, back to pending
await client.setEnabled('logger', true) // heartbeat starts again, fresh
await client.addPlugin({
  id: 'timer',
  plugin: timerPlugin,
  options: { every: 5 },
})
await client.removePlugin('heartbeat')
```

Swapping a provider for a different implementation of the same key restarts
every dependent against the new one, without any dependent knowing:

```ts
await client.setPluginList(
  client.pluginList.state.map((entry) =>
    entry.id === 'logger' ? { ...entry, plugin: bufferLogger } : entry,
  ),
)
```

## Options

Options are validated and defaulted by a **validator** — any
[Standard Schema](https://standardschema.dev) — before the instance starts, and
their type flows into `setup`. Invalid options put the instance in `error` with
a path-annotated message; it never starts.

```ts
import * as v from 'valibot'

const timerPlugin = createPlugin({
  name: 'timer',
  validator: v.object({ every: v.optional(v.number(), 1000) }),
  setup(instance, options) {
    const handle = setInterval(() => {}, options.every) // options: { every: number }
    instance.cleanup(() => clearInterval(handle))
  },
})

// Updating options restarts only this instance.
await client.setOptions('timer', { every: 250 })
```

## Actions and middleware

An **action** is a named operation a plugin exposes so other plugins can wrap it
with **middleware**. Middleware can change the input, change the result, or stop
the action by not calling `next` — and the action's owner cannot tell which.

```ts
import { createAction } from '@tanstack/compose'

const callTool = createAction<{ name: string; args: string }, string>(
  'tools.call',
)

const tools = createPlugin({
  name: 'tools',
  setup(instance) {
    instance.defineAction(callTool, ({ name, args }) => `${name}:${args}`)
  },
})

const shouting = createPlugin({
  name: 'shouting',
  setup(instance) {
    instance.use(callTool, ({ input, next }) =>
      next({ ...input, args: input.args.toUpperCase() }),
    )
  },
})

await client.dispatch(callTool, { name: 'echo', args: 'hi' }) // 'echo:HI'
```

## Events

An **event** is a typed notification; **listeners** observe it and cannot alter
it. A listener that throws is contained and reported, and affects neither the
emitter nor the other listeners. Whether `emit` waits for its listeners is part
of the event's definition and shows up in its type.

```ts
import { createEvent } from '@tanstack/compose'

const toolCalled = createEvent<{ name: string }>('tools.called')
const drained = createEvent<void>('tools.drained', { awaited: true })

instance.on(toolCalled, (payload) => console.log(payload.name))

instance.emit(toolCalled, { name: 'echo' }) // void
await instance.emit(drained, undefined) // Promise<void>
```

## Inspection

Everything the client knows is readable, and observable through
[`@tanstack/store`](https://tanstack.com/store) stores, so adapters and devtools
render live without polling.

```ts
client.inspect()
// [{ id: 'timer', plugin: 'timer', status: 'pending', missing: ['logger'] }, …]

client.resources('timer')
// { label: 'timer (timer)', children: [{ label: 'timer interval', children: [] }] }

client.instances.subscribe((snapshot) => render(snapshot))
client.pluginList.subscribe((list) => renderComposer(list))
```

A plugin may edit the plugin list it belongs to — including disabling itself —
through `instance.client`, which is how an application changes its own shape.

## Learn more

- [`DESIGN.md`](./DESIGN.md) — the kernel's lifecycle, reconciliation and inspection model
- [`CONTEXT.md`](../../CONTEXT.md) — the glossary these terms come from
- [`docs/acceptance/kernel.md`](../../docs/acceptance/kernel.md) — the contract, criterion by criterion
