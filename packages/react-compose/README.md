# `@tanstack/react-compose`

The React **adapter** for [`@tanstack/compose`](../compose), and the **slot**
registry every element on a page fills.

A slot is a named place in the UI, typed by the props it passes. A plugin fills
it with a renderer and an order; the fill is gone when the plugin's **cleanup**
runs. The page is whatever the enabled plugins have filled, and it changes while
the application runs.

## Installation

```sh
npm install @tanstack/react-compose @tanstack/compose react react-dom
```

## An application whose page is its plugin list

```tsx
import { createClient, createPlugin } from '@tanstack/compose'
import {
  ComposeProvider,
  Slot,
  createSlot,
  slotsKey,
  slotsPlugin,
} from '@tanstack/react-compose'
import { createRoot } from 'react-dom/client'

const root = createSlot('root')
const toolbar = createSlot<{ busy: boolean }>('toolbar')

const frame = createPlugin({
  name: 'frame',
  deps: [slotsKey],
  setup(instance) {
    const slots = instance.context.get(slotsKey)
    instance.cleanup(slots.declare(toolbar))
    instance.cleanup(
      slots.fill(root, {
        render: () => (
          <main>
            <Slot of={toolbar} props={{ busy: false }} />
          </main>
        ),
      }),
    )
  },
})

const stop = createPlugin({
  name: 'stop',
  deps: [slotsKey],
  setup(instance) {
    instance.cleanup(
      instance.context.get(slotsKey).fill(toolbar, {
        order: 10,
        render: ({ busy }) => <button disabled={!busy}>Stop</button>,
      }),
    )
  },
})

const client = createClient({
  plugins: [
    { id: 'slots', plugin: slotsPlugin },
    { id: 'frame', plugin: frame },
    { id: 'stop', plugin: stop },
  ],
})

createRoot(document.getElementById('root')!).render(
  <ComposeProvider client={client}>
    <Slot of={root} />
  </ComposeProvider>,
)
```

`await client.setEnabled('stop', false)` takes the button off the page. Nothing
restarts, and nothing else re-renders.

## Slots

```ts
createSlot<TProps>(name) // a list, in order
createSlot<TProps>(name, { cardinality: 'single' }) // the latest wins
createSlot<TProps>(name, { cardinality: 'keyed', key }) // one fill per key
```

The renderer of a fill is typed from the slot, with no cast:

```tsx
const message = createSlot<{ entry: SessionEntry }>('message', {
  cardinality: 'keyed',
  key: (props) => props.entry.kind,
})

slots.fill(message, {
  key: 'input',
  render: ({ entry }) => <p>{entry.kind === 'input' ? entry.text : null}</p>,
})
```

Rendering a slot no plugin fills renders nothing and is not an error.

## The `Slot` component

Fills render as bare siblings in order — layout belongs to the plugin that
renders the slot. Pass a render prop to wrap each one:

```tsx
<ul>
  <Slot of={toolbar} props={{ busy }}>
    {(rendered, fill) => <li key={fill.id}>{rendered}</li>}
  </Slot>
</ul>
```

## Hooks

| Hook                                    | What it reads                                                    |
| --------------------------------------- | ---------------------------------------------------------------- |
| `useClient()`                           | The client the provider was handed                               |
| `useContextKey(key)`                    | A **context key**, `undefined` while nothing provides it         |
| `useContextKey(key, { suspend: true })` | The same, suspending until it is provided                        |
| `usePluginList()`                       | The **plugin list**, re-read on every edit                       |
| `useInstances()`                        | Every **plugin instance** with its **status** and unmet **deps** |
| `useClientErrors()`                     | The failures the client contained                                |
| `useStore(store, select?)`              | Any store a plugin published                                     |
| `useFills(slot)`                        | The fills of one slot, settled and in order                      |

`useContextKey` re-renders when the key is provided or withdrawn, so a component
survives the plugin that provides what it reads being disabled:

```tsx
const tools = useContextKey(uiToolsKey)
return <button disabled={!tools} onClick={() => tools?.call('stop', {})} />
```

## Rendering a view

A **view** describes what it puts in a slot as plain data, because a function
cannot cross a **host** boundary. `createViewRenderer()` turns that data into a
component, so a plugin written as source can fill a slot on the page:

```ts
const renderer = createViewRenderer()

const Fill = renderer(
  {
    type: 'row',
    children: [
      { type: 'button', label: 'Summarise', onPress: 'press' },
      { type: 'text', text: '12 words', tone: 'muted' },
    ],
  },
  { press: async () => summarise() },
) as ComponentType

slots.fill(toolbar, { render: Fill })
```

`text` is a span with a tone class, `button` calls the handler its `onPress`
names, `input` is controlled and calls `onChange` as it is typed and `onSubmit`
on Enter, and `row` and `stack` are flex containers your stylesheet lays out.
An element of a type the vocabulary does not name renders nothing and is not an
error.

## Learn more

- [`DESIGN.md`](./DESIGN.md) — the slot model, cardinality, and where the registry lives
- [`examples/react/self-modifying-agent`](../../examples/react/self-modifying-agent) — an application where every element on the page is a plugin
- [`CONTEXT.md`](../../CONTEXT.md) — the glossary these terms come from
- [`docs/acceptance/ui.md`](../../docs/acceptance/ui.md) — the contract, criterion by criterion
