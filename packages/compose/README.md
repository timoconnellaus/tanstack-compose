# `@tanstack/compose`

The framework-agnostic kernel of TanStack Compose: the runtime object, the service
registry, the event bus, reversible effects, plugin lifecycle, and mounting.

> **Status: scaffold.** Every export is a typed placeholder that throws. See
> [`INTENT.md`](../../INTENT.md) for the invariants and [`ROADMAP.md`](../../ROADMAP.md)
> for the build order.

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
