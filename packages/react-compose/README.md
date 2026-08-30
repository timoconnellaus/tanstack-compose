# `@tanstack/react-compose`

The React adapter for [`@tanstack/compose`](../compose): a provider that puts a runtime
on context, and hooks that read services and the live composition tree.

> **Status: scaffold.** Every export is a typed placeholder that throws.

## Installation

```sh
npm install @tanstack/react-compose @tanstack/compose
```

## Intended shape

```tsx
import { ComposeProvider, useService } from '@tanstack/react-compose'

function Clock() {
  const clock = useService(ClockService)
  return <span>{clock.now()}</span>
}

;<ComposeProvider runtime={runtime}>
  <Clock />
</ComposeProvider>
```
