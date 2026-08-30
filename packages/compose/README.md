# `@tanstack/compose`

The framework-agnostic kernel of TanStack Compose: the client, plugins, context and deps,
cleanup, status, options, middleware and events, and plugin-list reconciliation.

> **Status: scaffold.** Every export is a typed placeholder that throws. See
> [`docs/acceptance/kernel.md`](../../docs/acceptance/kernel.md) for what done means and
> [`ROADMAP.md`](../../ROADMAP.md) for the build order.

## Installation

```sh
npm install @tanstack/compose
```

## Intended shape

```ts
import { createRuntime, definePlugin, defineService } from '@tanstack/compose'

const Clock = defineService<{ now: () => number }>('clock')

const clockPlugin = definePlugin({
  name: 'clock',
  setup(runtime) {
    // registrations made through the runtime are effects, undone on unload
  },
})

const runtime = createRuntime()
```
