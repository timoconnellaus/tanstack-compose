# `@tanstack/compose-devtools` — devtools design

This package is the **devtools** inspection surface for a live **client**. Terms
come from [`CONTEXT.md`](../../CONTEXT.md); the observable inputs come only from
the public client contract in `@tanstack/compose`.

## Two entries

- The root entry is framework-neutral. `createDevtools({ client })` derives a
  serialisable snapshot from the client's `pluginList`, `instances`, `context`
  and `errors` stores plus `resources(instanceId)`. A computed
  `@tanstack/store` store tracks those inputs, so one client publication batch
  produces one notification. `close()` owns and removes every subscription
  made through the devtools object.
- The `/react` entry is the React adapter. It reads the same client stores with
  `@tanstack/react-store`, then renders a `ComposeDevtoolsPanel` as a
  `TanStackDevtoolsReactPlugin`. The TanStack Devtools UI kit is Solid-based, so
  the React component owns a small Solid island; that island lets the panel use
  the kit's `MainPanel`, `Header`, `Section`, `Tag`, `Button`, `JsonTree` and
  theme provider without making React part of the root entry.

## Snapshot

`DevtoolsSnapshot` contains only arrays, records, strings, numbers and booleans.
Thrown values are normalised to a message and a bounded, cycle-safe `cause`
chain; no live `Error`, plugin, context value, cleanup or stub function crosses
the devtools boundary.

- **Instances** reads `client.instances`. `missing` is copied verbatim, so both
  **context key** and **action** deps retain the names the kernel reports.
- **Resources** calls `client.resources(id)` for every published instance and
  recursively copies the labelled tree. Resource values and cleanups are never
  inspected.
- **Plugin list** reads `client.pluginList`. Imported entries expose the plugin
  name; source entries expose only source length, host name and granted stub
  names. Options and source text are intentionally absent.
- **Context** reads `client.context` as key/provider rows. Rows, rather than an
  object keyed by name, preserve distinct context keys that happen to share a
  display name.
- **Errors** reads the already bounded `client.errors` store. Its `scope` is
  presented as the failure phase, alongside instance id, message and causes.

The plugin list store is the client's public source of truth. After an awaited
plugin-list edit it is the reconciled list; during an in-flight direct store
write the kernel does not expose its private applied list, so devtools cannot
distinguish intended from applied entries at that instant.

## Panels

- **Instances**: status, published phase and unmet deps. This is the default tab
  because explaining a pending instance is the primary job of these devtools.
- **Resources**: one labelled resource tree per instance.
- **Plugin list**: safe metadata for imported and source entries, including
  enabled state and grants.
- **Context**: each published context key and its providing instance.
- **Errors**: message, instance, failure phase and an expandable cause chain.

The kernel publishes instance snapshots only after a settle pass, when its
internal phase is `idle`; it does not publish `setup` or `removing`. The panel
therefore reports `idle` for each observable instance. Showing live phase
transitions would require a new kernel store field.

There is no trace panel in this slice. Event delivery and action/middleware
dispatch have no public observation hook today; a later trace panel needs that
kernel hook rather than patching interception into devtools.

## Why the panel avoids reactive props on the UI kit

`@tanstack/devtools-ui` components destructure their props (`({ children, ...rest })`) and re-spread `rest`
with a computed `class`. Under `solid-js/h` a getter prop on such a component — `variant`, or two reactive
attributes at once — re-enters Solid's scheduler until the stack overflows, in jsdom and in the browser alike.
The panel therefore gives every kit component plain values and puts reactivity where Solid handles it
directly: the tab bar is plain `button` elements with getters for `aria-pressed` and `data-selected`, and each
tab's content is a function child re-rendered from the snapshot signal. `h` also rejects `null`/`undefined`
children, so optional parts render as an empty array.

Outside a browser Node resolves the kit's Solid server build; the Vitest configs (this package and the
showcase) pin `resolve.conditions` to `browser` and inline `solid-js` and `@tanstack/devtools*` so jsdom
gets the client build. The showcase mounts the shell only when `import.meta.env.DEV && !TEST`.
