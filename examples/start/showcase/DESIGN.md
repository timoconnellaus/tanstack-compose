# Showcase S1 — design

This is slice 6 and implements pages 1–3 of
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

The browser constructs one client lazily in `src/compose-client.ts`. Tests use the same
factory to get a fresh real client. The root route owns neither plugin setup nor
cleanup: it only provides the browser client through `ComposeProvider`. Every
route has `ssr: false`; server clients, following and server-rendered fills are
slice 7.

The client starts exactly four trusted entries: `slotsPlugin`, `viewsPlugin`,
`tablePlugin` and `todoPlugin`. React components declare the slots they render
while mounted. They are not plugins.

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
  generations belong to slice 9.

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

## Decisions where the criteria are silent

- The demo table data and initial todos are deterministic literals so tests and
  screenshots have stable ordering.
- Due-date ordering puts dated items first, ascending, and items without a due
  date last; ties keep title order.
- The panel merges the plugin list with `client.instances`, keeping disabled
  entries visible so they can be enabled again.
- A source/view id already present is replaced as one list edit. Fixture page
  buttons are disabled while their id is present, preventing accidental
  duplicate ids.

## Why the client module is not `src/client.ts`

TanStack Start reads `src/client.tsx` (or `.ts`) as the application's custom
**client entry** — the module that hydrates the router. A compose client module
under that name is imported by Start's dev entry in place of hydration, and the
page never leaves its "Starting client…" fallback. The module is therefore
`src/compose-client.ts`, and Start uses its default entry.
