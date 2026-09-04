# `@tanstack/start-compose` — design

How a TanStack Start application renders one tenant/app **plugin list** on the
server, hydrates without a layout shift, follows it while the page is open, and
sends a **view**'s interactions back. Contract:
[`docs/acceptance/ui.md`](../../docs/acceptance/ui.md) §E–§F as amended and the
S2 staging in
[`docs/acceptance/examples.md`](../../docs/acceptance/examples.md). The
extension-surface stance is [ADR-0006](../../docs/adr/0006-an-extension-surface-on-ordinary-code.md).

## One authority and one follower

The server client lives in a Durable Object. An application chooses the object
id; the showcase uses `idFromName(`${tenantId}:${app.id}`)`, so each object owns
exactly one client and one plugin list. This package does not multiplex apps
inside a client.

The browser holds a `ComposeView`, not a client-shaped fake. The follower
contains the mirrored `pluginList` and `instances` stores, the context and error
stores required by the React adapter, and the slot registry expected by the
shell. Its plugin-list store holds `SnapshotEntry` values unchanged: catalog
references remain catalog references and written entries remain
`{ written: true }`; it never fabricates plugin source or a plugin object.

The follower has no host and never starts either a trusted plugin or plugin
source. Its only optional write-like view capabilities are `dispatch` and
`callSource`, which are transport calls to the server. It has none of a
`Client`'s mutation, lifecycle, event, or middleware methods, so `useClient()`
under `ComposeStart` fails clearly instead of granting no-op methods. Every
plugin-list mutation goes through `useComposeEdit()`.

Server halves and view modules both run through the server client's host. A
view module contributes a plain `ViewNode` tree through its `slots` grant. The
browser renders that data; it never receives or evaluates the module's source.

## Durable list and catalog boundary

`createComposeDurableObject(options)` returns a Durable Object class extending
the injected `base` constructor (`DurableObject` from `cloudflare:workers` in a
real app). The app supplies:

- initial serializable entries, or a function of the app id;
- a catalog mapping persisted names to trusted plugin objects;
- a grant catalog mapping persisted names to stub values;
- an optional action catalog for the ordinary base actions the shell dispatches;
- the host constructor and checker.

The generation log is stored under `compose:generations` before reconciliation.
Its entries' only
durable form is `{ id, plugin: { catalog } | { source }, options, enabled,
stubs: [names], host }`. Plugin objects and grant functions never enter
storage. On eviction, initialization reads the head's list, resolves it against the
current catalogs, and starts a new client. A functional initial list needs the
app id only for the first `snapshot(appId)`; after persistence, the object id
already isolates the app and no app discriminator is stored or accepted by
edits.

Each edit first derives the next full serialized list and appends a pending
generation through `@tanstack/compose/generations`; settlement finalises it as
`good` only when every enabled entry is active, otherwise `bad`. The snapshot
generation is the log generation, not a publication counter. Fill-only
publications may therefore repeat a generation and followers accept equal
generation numbers as newer whole state.

On boot, a missing log gets generation zero for the initial list. A head whose
base version differs from the option selected for this boot is copied into a
new pending generation before the fresh client checks it; the settled outcome
is then recorded. A matching settled head is reconstructed without inventing a
generation. `generations()` returns cloned history and `revert(n)` appends the
chosen entries under the current head's base version before reconciling them.

`reset(appId?)` is the explicit eviction-equivalent seam for an application that
selects a base per request (the showcase Upgrade toggle). It destroys only the
in-memory client, retains the log, and initializes again. `baseVersion` may be a
function of that boot id and `createChecker` may select the declarations for
the resulting version; fixed applications pass a string and one checker.

Explicitly narrowed `createSlotsStub({ slots })` grants also declare a missing
allowed list slot when used in the headless server client. A mounted browser
page's real declaration wins when present, retaining its cardinality and key
function. An unrestricted slots grant still requires a page declaration. This
is what lets an evicted DO reconstruct view fills before it renders a route.

## Snapshot and publication

`ComposeSnapshot` is the single transfer shape:

```ts
interface ComposeSnapshot {
  generation: number
  baseVersion: string
  outcome: 'pending' | 'good' | 'bad'
  lastKnownGood?: number
  pluginList: Array<SnapshotEntry>
  instances: Array<InstanceSnapshotWithSerializableError>
  fills: Array<{ id; instanceId; slot; order; key?; view: ViewNode }>
}
```

Catalog entries retain their catalog name. Source entries become
`{ written: true }`; source is never in a route loader result, HTML, WebSocket
message, or browser store. Instance errors retain only their message.

`serializeFills()` reads only fills tagged by the hosted view grant. The tag
holds the host-attached view instance id and its validated `ViewNode`.
`applySnapshot()` replaces the follower's previous generation in one store
batch, recreates renderers and binds every named callback to `press` with that
tagged id. A caller cannot substitute an id through view data.

The generation comes from the persisted append-only log and therefore remains
monotonic across eviction and every plugin-list edit.
When an application selects among bundled bases dynamically, an initialization
without a new selection hint keeps the stored head's `baseVersion`; this makes
the selected base survive object eviction. A supplied boot id remains the
authority for an intentional switch and can append a new-version generation.
Instance-store and fill-store changes queue publication. Changes arriving
while a publication is in progress queue another pass instead of being lost.
During an `edit`, intermediate reconciliation notifications are held; the
returned snapshot is produced only after `client.setPluginList()` settles.

`follow()` accepts a hibernatable WebSocket and immediately sends the current
whole snapshot. `ComposeStart` opens it only after hydration, ignores an older
generation, and reconnects with exponential backoff capped at five seconds.
The first message after every reconnect is whole state, so reconvergence needs
no missed-diff protocol.

The same socket carries a `BrowserStatusReport` in the other direction. A
followed fill reports `active` only after its React error boundary mounts; a
render failure reports the source handler's own message and removes that fill.
Reports name the snapshot generation, are held only for the lifetime of their
socket (as a hibernation-safe WebSocket attachment), and are exposed to server
integrations through `browserStatus()`. They are deliberately not stored in
the Durable Object's plugin data: after disconnect no browser is known to be
rendering that generation. A later agent-facing app can include this query in
its composer results without teaching this package about agents.

## Server calls and error ownership

The DO surface is `snapshot()`, `edit(op)`, `generations()`, `revert(n)`,
`reset(appId?)`, `dispatch(...)`, `press(...)`, the
operator-only `callSource(...)`, and `follow()`.

Before calling a view export, `press` proves that the current snapshot contains
a fill owned by `viewInstanceId` whose tree names that handler. It then calls
that exact view instance. The view's `server` grant derives its paired server
id from the host-attached view id, never from its input.

Errors have two audiences. The host keeps its diagnostic wrapper and
`SourceError` for operators. A product call receives the written handler's own
message: `callSource` and the `server` grant rethrow that message with the host
error on `cause`. Thus validation alerts and CSV failures do not acquire an
`@tanstack/compose: call failed —` prefix.

## SSR and hydration

`ComposeStart` creates its follower during render and applies the loader's
snapshot synchronously. The same component therefore seeds a fresh registry
for server rendering and seeds the browser registry before hydration; no fetch
is needed before first paint. Its `useSyncExternalStore` server snapshot is the
same object as its first client snapshot. `useComposeSnapshot()` exposes later
whole snapshots and `useComposeEdit()` sends authoritative edits.

## Deliberate limits

- Whole snapshots are preferred to diffs until measurement justifies another
  protocol.
- This package persists only the generation log needed to reconstruct the DO;
  base declarations, catalogs, plugin objects and grant implementations stay in
  the application.
- The app owns tenant identity, routing, cookies, authorization, catalogs, and
  deployment bindings.
- There is no in-process fallback in the deployed browser. An app may keep a
  separately selected browser-only development mode, as the showcase does.

## Criteria → tests

| Proof                                                                                      | Test                                                     |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| snapshot fills use the shell-owned id; a render failure reports and removes its fill       | `tests/snapshot.test.tsx`                                |
| server HTML and hydrated DOM are identical                                                 | `tests/hydration.test.tsx`                               |
| newer generations apply, older ones are ignored, and a closed follower reconnects          | `tests/follow.test.tsx`                                  |
| mounted follower status returns on the same socket and disconnect removes server status    | `tests/follow.test.tsx`, `tests/durable-object.test.ts`  |
| durable edits, source hiding, headless fills, presses, removal, and product error messages | `tests/durable-object.test.ts`                           |
| base-version boot generations, bad rechecks, revert under the current base, and repair     | `tests/durable-object.test.ts`                           |
| the actual Table shell hydrates with 30 rows and an export fill unchanged                  | `examples/start/showcase/tests/hydration.test.tsx`       |
| the facet-backed DO adds, presses, and removes the export pair                             | `examples/start/showcase/tests-workerd/deployed.test.ts` |

The Cloudflare integration tests require `@cloudflare/vitest-pool-workers`; a
run that cannot start workerd has not passed those rows.
