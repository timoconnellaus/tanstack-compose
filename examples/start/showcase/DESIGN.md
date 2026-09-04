# Showcase S1 and S2 — design

This is slices 6–7 and implements pages 1–3 of
[`docs/acceptance/examples.md`](../../../docs/acceptance/examples.md). The
product shell and pages are ordinary React code. Only the explicitly declared
actions, slots, context keys and grants are changeable by plugin source
([ADR-0006](../../../docs/adr/0006-an-extension-surface-on-ordinary-code.md)).

## Base and client lifetime

`src/base.ts` is a collection of plain exported values; `defineBase` and
generated declarations belong to slice 9. `tablePlugin` owns the fixed 30-row
dataset and `table.export`. `todoPlugin` owns the todo store and the three todo
actions. The store methods are ordinary base code; a hosted instance can reach
only the grants on its entry.

Every page is an **individual app** (`src/apps.ts`): its own client, its own
trusted plugin list, the grants its paste panel may hand out and the slots a
view may fill. The three apps share only the base module they draw from. Each
route renders its app in an `AppFrame` (`src/app/app-frame.tsx`), which owns the
`ComposeProvider`, the app's notifications and side slots, and **that app's**
plugin panel; the root route holds the site header and navigation and no client.
The browser keeps one client per app for the session (`src/browser-clients.ts`),
so navigating away and back neither restarts an app nor lets one app see
another's entries. Tests start an app's client with the same factory.

Production routes are SSR. An anonymous cookie supplies `tenantId`, and each
route resolves exactly one Durable Object with
`idFromName(`${tenantId}:${app.id}`)`. That object owns one server client built
from only that app's base entries. The panel therefore still shows the current
app's list, never a list multiplexed across pages.

The root/page loader fetches a whole snapshot. `ComposeStart` seeds the server
render and the hydration render from it, then follows the object's WebSocket.
All panel, fixture, remove, enable, disable, and paste operations are serialized
edits to the DO. The production browser has a follower with no host and runs no
plugin source. Vite selects `browser-pages.browser.tsx` only in
`dev:browser`; production resolves a placeholder module instead, keeping S1's
in-process client out of the deployed graph while retaining the jsdom oracle.

Every app's server client starts `slotsPlugin` and `viewsPlugin`; the table and
hostile objects add `tablePlugin`, and the todo object adds `todoPlugin`. An
explicit app slot allow-list lets hosted view modules fill the headless server
registry before a React page is mounted. React components declare the same
slots in browser-only mode. They are not plugins.

## Hosted pairs and grants

A fixture with a view becomes two source entries, `id` and `id.view`, using the
same pairing helpers as the composer. The server half receives the fixture's
explicit grants. The view receives `slots` narrowed to this base's slot names
and `server` narrowed to the server half's recovered named exports. Adding and
removing the pair is one plugin-list edit.

The host contract exposes each stub as one asynchronous callable taking one
structured-clone-safe argument. Consequently the hand-written S1 declaration
text represents object operations as tagged request objects (`data({ operation:
'rows' })` and `actions({ operation: 'wrap', ... })`). This is the wire-level
form of the `data.rows` and `actions.wrap` grants and avoids pretending the
current host can transfer an object containing methods. Slice 9's generated
base declarations may add authoring sugar without changing that boundary.

`actions` maps only `list.sort`, `item.validate` and `item.create` to action
definitions. Its handler registers middleware through the calling instance,
so removal runs the registration's cleanup. Named `before` and `after` exports
are called across the same instance's host boundary.

## Page proofs

- Table declares `table.actions`, renders the fixed rows, and adds the
  `export-csv` pair. Its server half reads only through `data`; its view refills
  the slot after export with a download button and a `pre` containing the last
  CSV so the result is observable without testing browser download behaviour.
- Todo renders base state and dispatches actions for validation, creation and
  sorting. Instance changes re-run sorting, so adding or removing middleware is
  visible without changing the base component.
- Hostile adds one source at a time and reports the real instance status and
  error. Its last-good list is page-local state and is updated only when the
  enabled entry ids and active instance ids agree exactly. Persisted
  generations belong to slice 9. The forged-id fixture asks `data` for an
  identity observation; the grant returns the caller id from its host-attached
  closure beside the claimed id, so the deployed follower shows a measured
  result rather than inventing one in browser code.

## Honest S1 host limits

The in-process host enforces structured-clone safety, setup/load/call failure
mapping, cleanup and unforgeable caller identity. It does not isolate ambient
globals, impose CPU or transfer budgets, or interrupt code. Therefore:

- `smuggles-a-function` fails at structured clone;
- `throws-in-setup` and the first call to `throws-in-handler` end in `error`;
- `forges-instance-id` stays active while the page shows the closure-carried id
  observed by `stubCallAction`, not the id placed in the request payload;
- `oversized-payload` sends 50 MB and proves only that the page recovers and
  remains usable; transfer refusal is a slice 7 host property;
- `reaches-outside` is present but disabled and explicitly labelled as needing
  the isolating host from slice 7.

No timeout, size limit or isolation claim is simulated in application code.

## S2 host and Worker shape

`wrangler.jsonc` binds `LOADER` with `worker_loaders` and a SQLite-backed
`TENANT` Durable Object. The generated Start server entry re-exports both
`ShowcaseTenant` and `ComposeStubLoopback`. The tenant builds its client with
`createTypeScriptChecker()` and `createFacetHost({ ctx, loader })`; each source
entry, including every view module, is the facet named by its entry id.

The facet's own storage implements `storage`, and its alarm implements
`schedule`; ordinary grants are the only values in its Dynamic Worker `env`.
A restart aborts the facet and retains state. Removing the entry stops it and
then deletes the facet and its storage. The loopback refuses JSON-encoded input
or output above 1 MiB.

The deployed hostile gallery enables the two S1-only-disabled fixtures.
`reaches-outside` attempts an ungranted fetch while the host has
`globalOutbound: null` and no tenant bindings in `env`. `spins` is a true busy
loop; the showcase gives the platform a 1000 ms CPU ceiling and the supervisor
a 250 ms wall clock, so the named wall-clock limit wins and aborts only that
facet. `oversized-payload` sends the same 50 MiB input and is refused by the
1 MiB loopback limit. Siblings remain ordinary active entries.

Server/view pairs are persisted as catalog names or source plus options,
enabled state, host, and grant names. Snapshot entries disclose catalog names
but replace source with `{ written: true }`. Generation and the list survive DO
eviction; version history and last-known-good persistence remain slice 9.

Product errors cross separately from host diagnostics. Base action middleware,
the view `server` grant, and DO `press()` return the written handler's message
to alerts/download behavior and retain the diagnostic wrapper on `cause`. The
hostile status panel is an operator surface and may show the host diagnostic.

## Decisions where the criteria are silent

- The demo table data and initial todos are deterministic literals so tests and
  screenshots have stable ordering.
- Due-date ordering puts dated items first, ascending, and items without a due
  date last; ties keep title order.
- The panel merges the current app's list with `client.instances`, keeping disabled
  entries visible so they can be enabled again.
- A source/view id already present is replaced as one list edit. Fixture page
  buttons are disabled while their id is present, preventing accidental
  duplicate ids.
- Deployed edits write the two halves sequentially. Each individual list is
  durable and valid; the whole-snapshot follower may briefly observe the server
  half before its view, which renders no partial fill.
- Production externalizes `cloudflare:workers` from the Start server build; it
  is provided by workerd at runtime. The source-level workspace aliases keep
  local packages independent of stale `dist` output.

## Why no module is named `src/client.ts`

TanStack Start reads `src/client.tsx` (or `.ts`) as the application's custom
**client entry** — the module that hydrates the router. A compose client module
under that name is imported by Start's dev entry in place of hydration, and the
page never leaves its "Starting…" fallback. The browser clients therefore live in
`src/browser-clients.ts`, and Start uses its default entry. Production reaches
that module only through the Vite alias selected by `--mode browser`.

## Tests

The original jsdom page suites still start fresh browser-only clients and cover
pages 1–3. `tests/hydration.test.tsx` renders the real Table frame with 30 rows
and an export fill to a string, hydrates the same snapshot, and compares the DOM
byte for byte. `tests-workerd/deployed.test.ts` addresses the tenant DO directly:
snapshot, add both export facets, observe the fill, press it for CSV, remove both
entries, then prove the fill and callable facet are gone.
