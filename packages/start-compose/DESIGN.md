# `@tanstack/start-compose` — design

How a TanStack Start application renders a tenant's **plugin list** on the server, hydrates without
a layout shift, follows changes while the page is open, and sends a **view**'s interactions back.
Contract: [`docs/acceptance/ui.md`](../../docs/acceptance/ui.md) §E–§F as amended, and
[`docs/acceptance/examples.md`](../../docs/acceptance/examples.md) staging S2. Stance:
[ADR-0006](../../docs/adr/0006-an-extension-surface-on-ordinary-code.md). This document is written
before the implementation; the implementer fills in what it leaves open and records the choice here.

## The two clients

|                 | Server client                                                                  | Browser client                                                                  |
| --------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Runs in         | the tenant's Durable Object                                                    | the page                                                                        |
| Plugin list     | the authority; edited by the operator's UI, the tools, the agent               | a mirror; never edited directly — edits are sent up                             |
| Trusted plugins | the base's server-side plugins (data, todos, storage handlers, grant handlers) | the shell: `slotsPlugin` and whatever the app registers for its own React fills |
| Plugin source   | server halves **and view modules**, in `@tanstack/compose-cloudflare`          | none, ever                                                                      |
| Fills           | produced by view modules through the `slots` grant; held as `ViewNode` data    | received as data; rendered by `<Slot>`                                          |

A view is data (`ViewNode` trees naming handlers by export name), so nothing about rendering it
requires running its code where it is rendered. That is what makes the server the single place
plugin source runs.

## The snapshot

```ts
interface ComposeSnapshot {
  generation: number // monotonically increasing per server change; the follower ignores older ones
  pluginList: Array<SerializedEntry> // catalog names and options, never plugin objects or source
  instances: Array<InstanceSnapshot> // as `client.instances` publishes them
  fills: Array<SerializedFill> // { id, instanceId, slot, order, key?, view: ViewNode }
}
```

One `ComposeSnapshot` is what a route loader fetches, what the HTML is rendered from, what the
browser hydrates from, and what each live update carries (whole snapshot; diffs are an optimisation
to be earned by a measurement). `pluginList` carries catalog names because the browser must not
receive source (E1 amended) and cannot receive a plugin object; the serializable list is slice 8's
work and this package consumes it.

## Server side

- `composeHandler(env)` — a Durable Object method surface the app binds: `snapshot()`,
  `edit(op)` (add from catalog / write source / enable / disable / configure / remove; the same
  operations the composer tools perform), `press({ viewInstanceId, handler, input })`, and
  `follow()` upgrading to a WebSocket that sends a snapshot on every publish.
- `press` is the browser side of E3: the shell attaches `viewInstanceId` from the fill it rendered;
  the DO calls the view module's named export through `client.callSource(viewInstanceId, handler,
input)`. Plugin code never chooses the id.
- The DO publishes a snapshot after every settle pass (`client.instances.subscribe`) and after
  every fills change (the slot registry store), coalesced per microtask.

## Start integration

```ts
// routes/__root.tsx
export const Route = createRootRoute({
  loader: () => getComposeSnapshot(), // a server function reading the tenant's DO
  component: () => (
    <ComposeStart snapshot={Route.useLoaderData()} follow="/api/compose/follow">
      <Outlet />
    </ComposeStart>
  ),
})
```

- `ComposeStart` creates the browser client once (module scope, guarded for SSR) with the shell
  plugins, seeds the slot registry and the mirrored `instances` store from the snapshot **before**
  first render, and provides the client. On the server the same component seeds a fresh registry
  from the loader's snapshot and renders; `<Slot>` reads through `useSyncExternalStore` with
  `getServerSnapshot` returning the seeded state, so server HTML and first client render are
  identical by construction. There is no client-side fetch before first paint.
- `follow` opens the WebSocket after hydration; each incoming snapshot with a higher `generation`
  replaces the mirrored stores in one `batch()`. Reconnect with backoff; on reconnect the first
  message is a full snapshot, which is what makes E2's "reconverge" true without special cases.
- `useComposeEdit()` returns the edit operations as server-function calls that resolve when the DO
  has settled and published; the UI shows the result from the next snapshot, not from the call.
- Presses: the React renderer of `ViewNode` (`react-compose`'s `views.tsx`) takes a `callbacks`
  map; here every handler name maps to `press({ viewInstanceId, handler, input })`. Input values
  round-trip the server on change; a local echo is an optimisation to be earned.

## What this package does not do

- It never runs a host in the browser. `inProcessHost` stays for tests and for apps that choose a
  browser-only client (slice 6).
- It does not know what a page is. Pages are the app's routes; a fill renders wherever the app put
  the `<Slot>`.
- It does not persist anything. The plugin list's persistence and generations are the server
  client's (slices 8–9); this package moves snapshots.

## Criteria → tests (to be filled in by the implementer)

E1 mirror by content of snapshot; E2 reconnect and reconverge; E3 press carries the shell's id and
a forged id is refused; E4 browser statuses visible on the server (a follower reports its render
errors back on the same socket); F1–F3 as written; plus **no layout shift**: the server HTML for a
page with fills equals the DOM after hydration (a jsdom test that renders both and compares).
