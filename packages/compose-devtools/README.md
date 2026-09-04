# `@tanstack/compose-devtools`

Devtools for a live [`@tanstack/compose`](../compose) client: plugin instance
status and unmet deps, held resources, the plugin list, context providers and
contained errors.

## Installation

```sh
npm install @tanstack/compose-devtools
```

## Framework-neutral snapshots

```ts
import { createDevtools } from '@tanstack/compose-devtools'

const devtools = createDevtools({ client })

console.log(devtools.snapshot())
const unsubscribe = devtools.subscribe((snapshot) => {
  sendToYourOwnDevtools(snapshot)
})

unsubscribe()
devtools.close()
```

Snapshots are plain serialisable data. Plugin source, options, context values,
cleanup functions and stub implementations are not included.

## React and TanStack Devtools

```tsx
import {
  TanStackDevtools,
  composeDevtoolsPlugin,
} from '@tanstack/compose-devtools/react'

export function App() {
  return (
    <>
      <YourApplication />
      <TanStackDevtools plugins={[composeDevtoolsPlugin(client)]} />
    </>
  )
}
```

React and React DOM are peers used only by the `/react` entry. The default
Instances tab names every context-key and action dep a pending instance is
waiting for. The other tabs show Resources, Plugin list, Context and Errors.

Event and middleware traces are not available yet; they require a public kernel
observation hook.
