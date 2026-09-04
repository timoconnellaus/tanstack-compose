# `@tanstack/react-compose` — design

The React **adapter**, the **slot** registry it renders through, and the
framework-neutral **view** grant runtime. The contract is
[`docs/acceptance/ui.md`](../../docs/acceptance/ui.md) §A and §B; the terms are
[`CONTEXT.md`](../../CONTEXT.md)'s.

Two things live here, and the split between them is the important line:

- **the registry** — framework-agnostic. It holds fills, settles them by
  cardinality, and publishes its state as a `@tanstack/store` store. It holds
  components but never renders one.
- **the view runtime** — framework-agnostic. It owns `ViewNode`, the `slots`
  and `server` stubs, their declaration text and the pairing convention. It is
  in `src/view-runtime.ts`, which names no React API, so non-React packages can
  import the `@tanstack/react-compose/view-runtime` subpath without loading the
  adapter.
- **the adapter** — React. A provider, hooks over the client's stores, a hook
  over a context key, and the `Slot` component that renders what the registry
  settled.

## Slots

A **slot** is created the way a **context key** is, and for the same reason
(ADR-0001): the props type travels with the value, so a **fill**'s renderer is
typed from the slot it fills with no module augmentation and no casts (B3).

```ts
const chatSide = createSlot('chat.side')
const inputActions = createSlot<{ draft: string }>('chat.input.actions')
const message = createSlot<{ entry: SessionEntry }>('chat.message', {
  cardinality: 'keyed',
  key: (props) => props.entry.kind,
})
```

### Cardinality

How many fills a slot takes is part of the slot, not of the fill, so a plugin
filling one cannot change the rules for the plugins that fill it beside them.

| Cardinality | What renders                                                     |
| ----------- | ---------------------------------------------------------------- |
| `list`      | Every fill, sorted by `order`, ties broken by registration order |
| `single`    | The fill registered last                                         |
| `keyed`     | One fill per key, the latest for that key                        |

A `keyed` slot takes a `key` function rather than the name of a prop, because a
key is often derived — `entry.kind`, not `key`. The slot's props carry the
value; `<Slot of={message} props={{ entry }} />` runs the function and renders
the one fill registered under that key. Nothing registered for that key renders
nothing (A4), which is how a message list can render a session log whose entry
kinds it does not enumerate.

`single` deliberately ignores `order`: latest wins is a replacement rule, and
ordering a replacement would make "which one wins" depend on two things.

### The registry as data

A `Fill` is `{ id, slot, order, key?, render }`. Everything but `render` is plain
data. That is the whole of the React-specific surface, so an adapter for another
framework can reuse the registry by putting its own component type in `render`.
`resolveFills(slot, registered)` is exported for the same reason: settling by
cardinality is not React's job.

Fills live in `Store<{ fills, slots }>` (A2, ADR-0002). Only the array of the
slot that changed gets a new identity, so a renderer of another slot reads the
same array back from `useSyncExternalStore` and does not re-render.

### Why the registry is here and not in the kernel

The kernel has no opinion about UI, and a UI-less client should not carry a slot
registry. A separate `@tanstack/compose-ui` would be a package holding one file
that every adapter must depend on anyway, and no second adapter exists yet to
justify the seam. So it lives in the React adapter with a clean line drawn
through the middle of `src/slots.tsx`: everything above the line names no React
API but `ComponentType`. If a second adapter ever arrives, that half moves out
without changing its shape.

`Slot` names both the definition and the component that renders it, which is why
they share a module: a function and an interface of the same name merge, so
`import { Slot }` gives the component and `import type { Slot }` gives the
definition.

### Resolving a slot by name

`registry.slot(name)` exists because a written **view** names the slot it fills
as a string — it has no value to import. A slot is resolvable once something
declares it (`registry.declare(slot)`, from the plugin that renders it) or fills
it; both are counted, and the name is forgotten when the last of them is undone.
`fill` accepts any `AnySlot`, so a view's handler can build a component and fill
a slot it only knows by name.

### `slotsPlugin`

One plugin provides `slotsKey` for the life of the client (A2). It is part of the
**shell**, and belongs among the entries an operator protects: everything on the
page depends on it.

## The adapter

### `ComposeProvider`

Puts a `ComposeView` on React context. `ComposeView` is the read surface the
adapter actually needs: readable `pluginList`, `instances`, `context`, and
`errors` stores, `getContext`, `inspect`, and optional `dispatch` and
`callSource`. Its plugin-list entries expose only `id`, `options`, and
`enabled`, so both an authoritative `Client` and a browser-safe snapshot can
satisfy the interface without pretending to hold the other's plugin value.

`useComposeView()` returns that read surface. `useClient()` remains the hook
for code that needs plugin-list mutation, middleware, events, or
lifecycle control. It checks structurally for `setPluginList` and throws a
specific error when the provider holds only a view. The store and context hooks
use `useComposeView()`, as do `Slot` and the view renderer transitively; none of
them require a mutating client.

The provider does **not** create or destroy what it is handed: its lifetime is
the caller's, so a re-mount never restarts an application, and a test can drive
a client before and after rendering.

### `useContextKey(key, { suspend? })`

B2 asks for a read that re-renders when the key is provided or withdrawn. The
observation is `client.context` — the store of which key is provided by which
`active` instance — so a provider that comes and goes through a plugin-list edit
reaches the UI without anything else restarting. The value itself is read with
`client.getContext(key)` inside `useSyncExternalStore`'s snapshot, which keeps
the returned reference stable while the provision is unchanged.

`{ suspend: true }` throws a promise that resolves the first time the key is
provided; the overloads make the return type `TValue` in that case and
`TValue | undefined` otherwise, so the caller's choice is in the type.

A plugin that declares a key in its `deps` does not need this hook at all: it
reads the value in `setup` and closes over it, and the client guarantees the
instance is not `active` without it. The hook is for a component that wants to
survive the key going away — the plugin panel in the example reads the agent
this way so that it stays on the page with inert buttons rather than vanishing.

### `Slot`

Renders the settled fills in order as bare siblings. Layout is the business of
the plugin that renders the slot (A3), so `Slot` adds no element of its own; a
caller that wants each fill wrapped passes a render prop as `children`, which is
handed the rendered fill and the `Fill` record. A slot with no fills, and a slot
with no registry above it at all, render nothing (A4).

`props` is required exactly when the slot passes props, through a conditional on
`undefined extends TProps`.

### Hooks over the view's stores

`usePluginList`, `useInstances` and `useClientErrors` are one hook per view
store, and `useStore` is re-exported from `@tanstack/react-store` for the stores
plugins publish themselves — an agent's status, a session log. The adapter adds
nothing to it.

## The view runtime and renderer

A **view module** cannot hand the page a renderer, because a function does not
cross a **host** boundary. It describes what it puts in a **slot** as plain data
instead. In a browser-only client the module and renderer happen to share the
browser; in the served shape the module runs in the server host and only its
`ViewNode` reaches the browser. The declaration text, validation, fill
ownership, slot narrowing and server-half calls are UI concerns and therefore
live here, not in the agent layer (ADR-0006).

`viewsPlugin` publishes the slot registry and React renderer under the two
framework-neutral context keys the view stubs depend on. `createViewRenderer()`
turns the data into a React component:

```ts
type ViewRenderer = (
  view: ViewNode,
  callbacks: Readonly<Record<string, ViewCallback>>,
) => unknown

const renderer = createViewRenderer()
const Fill = renderer(tree, callbacks) as ComponentType
```

Hosted fills retain optional `{ instanceId, view }` serialization metadata on
their `Fill` record. Ordinary React fills omit it. `@tanstack/start-compose`
uses only tagged fills to build a snapshot and reconstructs their callbacks
from the host-attached instance id.

An explicitly narrowed `createSlotsStub({ slots })` can fill an allowed list
slot before a page is mounted: if the server registry does not contain that
name, the allow-list is itself the trusted declaration and the fill declares a
default list slot. If the page already declared it, its actual cardinality and
key function win. The unrestricted grant still refuses an undeclared name.

`createServerStub()` derives the paired server id from the view instance id. If
that server handler rejects, the grant rethrows its source message for the view
and retains the host diagnostic on `cause`; product errors therefore never
gain a host-prefix at this hop.

| Node            | Renders as                                                         |
| --------------- | ------------------------------------------------------------------ |
| `text`          | `<span>` with `view-text` and a tone class                         |
| `pre`           | `<pre>` for result data a view wants to expose                     |
| `button`        | `<button>` calling the handler `onPress` names                     |
| `input`         | a controlled input; `onChange` as it is typed, `onSubmit` on Enter |
| `row` / `stack` | a flex container the page's stylesheet lays out                    |
| anything else   | nothing, and no error                                              |

Three decisions worth stating:

- **There is one vocabulary.** `ViewNode` and the grant declarations are
  authored by the framework-neutral view runtime. The agent layer re-exports
  them for compatibility and adds only its `agent` and `session` stubs.
- **An unknown element renders nothing rather than throwing.** A view written
  against a vocabulary the page does not have yet degrades in place; the rest of
  the tree, and the rest of the page, keep rendering (D1a).
- **Enter submits an input, rather than a `<form>` doing it.** A fill lands
  wherever the slot is, and the slot may already be inside a form — the example
  app's input actions are — where a nested `<form>` is invalid markup.
- **A button may name a download.** When its handler returns text, the renderer
  uses a `data:` URL and a temporary `<a download>` to start the download. The
  handler remains ordinary host RPC, and the view source receives no DOM grant.

## What the adapter does not know

There is nothing about agents, chat, sessions, models or tools in this package
(B1). Views are an application UI extension surface, so the vocabulary, grants
and their shell plugin do not need an agent in order to exist. The non-React
subpath keeps the grant runtime usable by example-local agent code without
making that code import React components.

## UI events are actions

Not enforced by this package, but the shape it is designed for: a click that
changes agent state dispatches an **action** the plugin that owns the button
defined, so **middleware** applies to a person's click exactly as it applies to
the model's tool call (C4). The adapter never dispatches anything itself.

## Decisions taken where the criteria were silent

- **A fill's `order` defaults to `0`,** and ties keep registration order, so a
  plugin that does not care about position never has to pick a number.
- **`fill` returns a cleanup** rather than taking an owner: the instance's
  `cleanup` already is the ownership mechanism, and a fill is one more held
  resource (A1).
- **A fill id is `slot#n`,** unique within a registry, so a renderer has a React
  key that does not depend on what filled the slot.
- **`declare` is separate from `fill`,** so a slot nothing has filled is still
  resolvable by name for a view, and a plugin that only renders a slot still
  publishes it.
- **`ComposeProvider` does not destroy the client.** The alternative — owning the
  lifetime — makes strict mode restart the application and makes a test unable to
  outlive its own render.
